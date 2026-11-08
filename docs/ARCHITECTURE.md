# Architecture

## Overview

```
Browser (React SPA)  ──HTTPS / JSON──►  NestJS API  ──Prisma──►  PostgreSQL
        │                                   │
        └──────── @ledgernest/shared ───────┘   roles, permissions, accounting rules
```

| Layer | Technology | Responsibility |
|---|---|---|
| Web | React 19, TypeScript, Vite, Tailwind CSS, Framer Motion, i18next, TanStack Query | Screens, forms, motion, translations, caching server data |
| API | NestJS (modules → controllers → services → Prisma) | Authentication, authorisation, validation, business logic, audit log |
| Shared | TypeScript package built to ESM + CJS | One source of truth for roles, permissions and accounting rules |
| Data | PostgreSQL (Neon in the cloud, local Postgres in development) | Relational, transactional storage |

## Multi-tenancy

- One database, with every business table carrying an `organizationId`.
- The API resolves the current organisation from the signed-in user's membership and **always** filters by it.
- Super Admins act at the platform level; organisation roles act inside one organisation.

## Authentication

- Passwords are hashed with **Argon2id**. Policy (12+ characters, upper, lower, number) lives in `packages/shared` so the web form and the API agree.
- Sign-in returns a **15-minute access token** (JWT, sent as `Authorization: Bearer`). The **refresh token** (14 days) is set as an `httpOnly` cookie limited to `/api/v1/auth`, so page scripts can never read it.
- Only a SHA-256 hash of each refresh token is stored. Every refresh **rotates** the token; presenting an already-used token is treated as theft and revokes the whole session.
- Unknown email and wrong password get the same message and take about the same time. After 5 wrong passwords the account locks for 15 minutes. Sign-in is also rate-limited per IP.
- Every sign-in, failure, lockout, token reuse and sign-out is written to the audit log.

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/auth/login` | Email + password → access token, sets the refresh cookie |
| `POST /api/v1/auth/refresh` | Rotates the refresh cookie → new access token |
| `POST /api/v1/auth/logout` | Revokes the session, clears the cookie |
| `GET /api/v1/auth/me` | The user, their organisations, role and permissions in each |

In the web app, the access token is kept in memory only (never in `localStorage`). A 401 triggers one silent refresh and retry. Refreshes run inside a browser-wide lock (`navigator.locks`), so two tabs never send the same refresh token at once, which the API would treat as theft. Signing out in one tab signs out every open tab (`BroadcastChannel`).

## Authorisation

- Permissions are strings like `journal.post` or `users.invite`, defined in `packages/shared`.
- Each role is a set of permissions. Custom roles are stored per organisation.
- API endpoints declare their permission with a decorator, and a guard checks it. The web app uses the same matrix to hide what you can't do.

## Accounting rules

- Amounts are integers in the smallest currency unit (e.g. paise, cents).
- A journal entry must have at least two lines, and debits must equal credits.
- Posted entries are immutable: corrections are made with a reversing entry.
- Periods can be locked; nothing posts into a locked period.

## Decisions

Architecture decision records live in [`docs/adr`](adr).
