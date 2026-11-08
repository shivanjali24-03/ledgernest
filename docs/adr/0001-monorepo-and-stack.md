# ADR 0001: One repository with a shared rules package

**Status:** accepted

## Context
LedgerNest has a web app and an API that must agree on roles, permissions and accounting rules. Keeping those rules in two places would let them drift apart, which is dangerous for financial software.

## Decision
- Use a single repository with npm workspaces: `apps/web`, `apps/api` and `packages/shared`.
- Put roles, permissions and accounting rules in `packages/shared`, built to both ESM (for the web app) and CommonJS (for NestJS).
- Use PostgreSQL, because accounting needs transactions, constraints and joins.
- Use only free hosting: GitHub Pages (web demo), Render (API) and Neon (PostgreSQL).

## Consequences
- One pull request can change the rule, the API and the UI together, reviewed as one unit.
- CI builds the shared package first, then the apps.
