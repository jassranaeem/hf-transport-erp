# HF Transport ERP Enterprise Edition v2.0 – Phase 1: Enterprise Foundation

Welcome to the production-grade Enterprise Transport Management Platform architectural documentation. This document covers the core architecture, schemas, and API standards of Phase 1: Enterprise Foundation.

## Core Architectural Design

The platform uses a modular, secure, full-stack layout designed to scale to 1,000+ vehicles and multi-branch operations:

```
├── client/                     # Frontend client API wrappers & state
├── server/                     # Express controllers, routers, and RBAC middleware
├── src/
│   ├── db/                     # Drizzle ORM schemas and pool connection
│   │   ├── schema.ts           # Core Postgres tables (Users, AuditLogs)
│   │   ├── index.ts            # PG pool with object-based pooling
│   │   └── drizzle.config.ts   # Drizzle Kit admin migration settings
│   ├── lib/
│   │   ├── firebase.ts         # Client Firebase Auth initialization
│   │   └── firebase-admin.ts   # Server Firebase token verification
│   └── middleware/
│       └── auth.ts             # Auth & RBAC verification
├── database/                   # Schema re-exports for root folder consistency
├── tests/                      # Auth and middleware tests
├── docs/                       # Architectural documentation
├── uploads/                    # Local storage placeholders
└── logs/                       # Access & server log placeholders
```

## Security & Auth Stack

- **JWT Authentication**: Powered by Firebase ID Tokens (verification in `src/middleware/auth.ts` via `firebase-admin`).
- **Hierarchical RBAC**: Enforces strict endpoint checks for:
  - `Super Admin` (universal access)
  - `Admin`
  - `Operations Manager`
  - `Dispatcher`
  - `Accountant`
  - `Fleet Manager`
  - `HR Manager`
  - `Driver`
  - `Viewer`
- **In-Memory Token Defense**: Tokens are stored solely in application memory (never leaked to `localStorage` or insecure cookies).

## Database & Auditing Standards

- **Global Soft Delete**: Every table includes `is_deleted`, `deleted_at`, and `deleted_by`. Read queries strictly filter by `is_deleted = false`.
- **Immutable Auditing**: Every data modification (Create, Update, Delete) and security event (Login, Logout, Role Change) automatically registers a detailed audit log entry inside the `audit_logs` table, storing:
  - Done action, table, and row record ID.
  - Snapshot diffs (`old_values` vs `new_values` JSON).
  - Actor reference (`performed_by`), source IP, and browser User-Agent.

## Production API Endpoints

All endpoints use standardized HTTP status codes, validation, structured JSON, pagination, and sorting:

- `GET /api/health` - Health and status metrics.
- `POST /api/auth/login` - Synchronizes and validates login, writing audit records.
- `POST /api/auth/logout` - Terminates the active session and logs audit.
- `GET /api/auth/me` - Retrives database profile and active role details.
- `GET /api/users` - Paginated & sorted list of team members (Admin-restricted).
- `PUT /api/users/:id/role` - Modifies roles with complete security checks.
- `DELETE /api/users/:id` - Performs a soft-delete of a user.
- `GET /api/audit-logs` - Queryable database modification log records.
