<div align="center">

# LedgerNest

**Modern accounting software for every business, in every language.**

Double-entry bookkeeping, invoices, banking and real-time reports, with role-based access from Super Admin to Viewer.

![React](https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white)

</div>

> **Status:** early development. See the [feature list](docs/FEATURES.md) for what's planned and what's done.

## Why LedgerNest

- **Works for any domain:** industry chart-of-accounts templates for retail, services, healthcare, education, manufacturing, non-profits and more.
- **Roles you can trust:** Super Admin, Owner, Admin, Accountant, Bookkeeper, Auditor and Viewer, plus custom roles.
- **Accurate by design:** money is stored as integers, every journal entry must balance, and posted entries are reversed, never edited.
- **Multi-language:** English, Hindi, Marathi, Spanish, French, German and Arabic (right-to-left).
- **Feels fast:** a motion system built for 60–240 Hz displays.

## Repository layout

```
apps/web         React 19 · TypeScript · Vite · Tailwind CSS · Framer Motion · i18next
apps/api         NestJS · Prisma · PostgreSQL · JWT · role-based access control
packages/shared  Roles, permissions and accounting rules used by both apps
docs/            Feature list, architecture and decision records
```

## Getting started

**You need:** Node.js 22+ and PostgreSQL 15+ (or a free [Neon](https://neon.tech) database).

```bash
npm install                 # installs every workspace
npm run build -w @ledgernest/shared
npm run dev:api             # API on http://localhost:3000/api/v1 (docs at /docs)
npm run dev:web             # web app on http://localhost:5173
```

Full setup, including the local database and seeding the first Super Admin: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

| Script | What it does |
|---|---|
| `npm run build` | Build shared, web and api |
| `npm test` | Run every workspace's tests |
| `npm run lint` | Lint every workspace |

## Contributing

We use a **develop → staging → main** flow with pull requests and code review. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_REVIEW.md](CODE_REVIEW.md) before opening a PR.

## Free to run

LedgerNest is built only on free resources: GitHub (code, Actions, Pages), [Neon](https://neon.tech) for PostgreSQL and [Render](https://render.com) for the API, all on their free tiers.
