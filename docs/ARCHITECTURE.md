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
