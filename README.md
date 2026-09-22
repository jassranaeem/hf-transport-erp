<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# HF Transport ERP

Enterprise Transport Management Platform - React 19 + Express + Drizzle ORM + PostgreSQL + Firebase Auth.

View in AI Studio: https://ai.studio/apps/95fe5615-ae60-4367-a812-1750cd8e175d

## Run locally / outside AI Studio

AI Studio injects secrets and Google credentials automatically. Everywhere else
you must provide them yourself, otherwise **login silently fails with 401**.

**Prerequisites:** Node.js 20+, Docker (for Postgres/Redis).

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env.local
   ```
   Then edit `.env.local`:
   - `JWT_SECRET` - **required.** `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
   - `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` - the account that is always
     Super Admin (defaults to jassranaeem@gmail.com). If the password is blank, a
     random one is printed to the server console on first boot.
   - `GOOGLE_CLIENT_ID` - optional, for "Sign in with Google". Create an OAuth
     2.0 **Web** client at https://console.cloud.google.com/apis/credentials and
     add your origin to "Authorized JavaScript origins". Client ID only (public).
   - `GEMINI_API_KEY` - from https://aistudio.google.com/app/apikey
   - `VITE_GOOGLE_MAPS_API_KEY` - not used (the live GPS map uses OpenStreetMap).
   - Database vars already point at the Docker Postgres below.

3. **Start Postgres + Redis**
   ```bash
   docker compose up -d db cache
   ```
   No Docker? A portable PostgreSQL 16 is already set up on this machine at
   `C:\Users\HP\hfpg` (db `hf_transport_erp`, user `postgres`, pw `hf_secure_pass_2026`,
   port 5432 — matches `.env.local`). Start / stop / status:
   ```bash
   "C:\Users\HP\hfpg\bin\pg_ctl.exe" -D "C:\Users\HP\hfpg\data" start
   "C:\Users\HP\hfpg\bin\pg_ctl.exe" -D "C:\Users\HP\hfpg\data" stop
   "C:\Users\HP\hfpg\bin\pg_ctl.exe" -D "C:\Users\HP\hfpg\data" status
   ```
   Redis is optional (the app falls back to an in-memory cache).

4. **Create the database schema** (first run only)
   ```bash
   npm run db:migrate
   ```
   (`npm run dev` / `npm start` also applies migrations automatically on boot.)

5. **Run the app**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000

### Authentication

Native, self-hosted - **no Firebase**. On first boot the Super Admin account
(`SUPER_ADMIN_EMAIL`) is created; log in with its password (printed to the
console if you didn't set `SUPER_ADMIN_PASSWORD`), or with "Sign in with Google"
using that same email once `GOOGLE_CLIENT_ID` is set.

- **Sign In** - email + password.
- **Request Access** - self-registration; new accounts land in *Pending
  Approval* until a Super Admin approves them (System Configuration -> Users).
- **Sign in with Google** - shown when `GOOGLE_CLIENT_ID` is configured.
- Sessions are JWTs (`JWT_TTL_SECONDS`, default 7 days) kept in the browser.
- Admin password reset (System Configuration -> Users -> reset) issues a
  one-time temporary password; the user changes it via the account menu.
- **Developer login** button appears only in dev builds when
  `DEV_AUTH_BYPASS=true` - skips auth entirely for local work.

## Production

Full guide: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — free option (Render +
Neon), Docker, bare VPS with PM2, and Cloud Run.

Quick local production run:
```bash
cp .env.production.example .env.production   # fill JWT_SECRET, DATABASE_URL, ...
npm run build
env $(grep -v '^#' .env.production | xargs) npm start
```

Production hardening built in: config validation refuses to boot on a weak/missing
`JWT_SECRET` or `DEV_AUTH_BYPASS=true`; HSTS + tightened CSP; CORS allowlist
(`CORS_ORIGINS`); `trust proxy` (`TRUST_PROXY`); 5xx responses don't leak
internals; SIGTERM graceful shutdown; migrations auto-apply on boot;
`Dockerfile` runs as non-root with a healthcheck.

## Docs

- [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md)
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- [docs/GPS-TRACKING.md](docs/GPS-TRACKING.md)
- [docs/DATA-IMPORT-EXPORT.md](docs/DATA-IMPORT-EXPORT.md)
