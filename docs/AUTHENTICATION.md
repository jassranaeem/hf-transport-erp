# Authentication

Native, self-hosted auth. **Firebase has been removed.**

## What it provides

| Method | Endpoint | Notes |
|--------|----------|-------|
| Email + password sign up | `POST /api/auth/register` | `{ email, password, name?, phone?, department?, requestedRole? }` -> `Pending Approval` (unless the email is `SUPER_ADMIN_EMAIL`, or it is the very first account) |
| Email + password login | `POST /api/auth/login` | bcrypt verify |
| Sign in with Google | `POST /api/auth/google` | `{ credential, requestedRole? }` - verifies a Google Identity Services ID token against Google's public certs; needs `GOOGLE_CLIENT_ID` |
| Submit / update role request | `POST /api/auth/request-role` | `{ requestedRole }` - for a still-pending user |
| Current user | `GET /api/auth/me` | requires a valid session; includes `requestedRole` |
| Logout | `POST /api/auth/logout` | stateless - client drops the token |
| Change password | `POST /api/auth/change-password` | `{ currentPassword, newPassword }` |
| Public config | `GET /api/auth/config` | `{ googleClientId, requestableRoles }` for the sign-in screen |

### Sign-up + role approval flow

1. A new user signs up (email/password **or** Google) and picks a **Requested
   Role** (`Admin`, `Operations Manager`, `Fleet Manager`, `Dispatcher`,
   `Finance Manager`, `Accountant`, `HR Manager`, `Fuel Manager`,
   `Workshop Manager`, `Auditor`, `Driver`, `Viewer` - never `Super Admin`).
   If they signed in with Google before choosing one, the "Account Pending"
   screen shows the picker and calls `/api/auth/request-role`.
2. They land in **Pending Approval** - no ERP access yet.
3. A Super Admin opens **System Configuration -> Users**, sees `wants: <role>`
   next to the pending user, and clicks **Approve as `<role>`** (Manage menu).
   That single action sets the role and flips status to `Approved`.
4. The user's next "Check Status" (or re-login) drops them into the dashboard
   with that role's permissions.

The **"Continue with Google"** button only appears when `GOOGLE_CLIENT_ID` is set
on the server - no half-configured error state.

Sessions are **JWTs** (`HS256`, signed with `JWT_SECRET`, `JWT_TTL_SECONDS`
default 7 days) carrying `{ uid, email }`. The browser stores it in
`localStorage` and sends it as `Authorization: Bearer <token>`. `requireAuth`
verifies it and loads the user from PostgreSQL.

## The Super Admin

`SUPER_ADMIN_EMAIL` (default `jassranaeem@gmail.com`) is **always** forced to
`role = "Super Admin"`, `status = "Approved"` - on every login, on boot, and
whenever that identity is synced. Signing in with that Gmail via Google, or with
its password, both resolve to the same account and the same privileges.

On first boot the account is seeded with a password:
`SUPER_ADMIN_PASSWORD` if set, otherwise a random one printed to the console.

## Environment

| var | required | purpose |
|-----|----------|---------|
| `JWT_SECRET` | yes (prod) | signs session tokens. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_TTL_SECONDS` | no | session lifetime, default `604800` |
| `SUPER_ADMIN_EMAIL` | no | default `jassranaeem@gmail.com` |
| `SUPER_ADMIN_PASSWORD` | no | seed password for the super admin (else random, printed once) |
| `GOOGLE_CLIENT_ID` | no | OAuth 2.0 **Web** client ID - enables "Sign in with Google" |
| `DEV_AUTH_BYPASS` | no | `true` + non-production => a "Developer login" button that skips auth |

### Setting up "Sign in with Google"

1. https://console.cloud.google.com/apis/credentials -> **Create credentials** ->
   **OAuth client ID** -> Application type **Web application**.
2. **Authorized JavaScript origins**: add `http://localhost:3000` and your
   production URL.
3. Copy the **Client ID** into `GOOGLE_CLIENT_ID` (no client secret needed).
4. Restart. The button appears automatically.

## Approving users

New self-registrations are `Pending Approval` and see a holding screen. A Super
Admin approves them in **System Configuration -> Users** (`PUT /api/users/:id/role`
with `status: "Approved"` and a real role).

## Schema

`users` gained `password_hash` (bcrypt; null for Google-only accounts) and
`auth_provider` (`password` | `google`). `uid` is now an internal id
(uuid for password accounts, `google:<sub>` for Google).
