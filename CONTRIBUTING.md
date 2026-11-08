# Contributing to LedgerNest

Thanks for helping build LedgerNest. This guide explains how work flows from an idea to production.

## Branches and environments

```
feature/<issue>-name ──PR──► develop ──release PR──► staging ──release PR──► main ──► tag vX.Y.Z
                              (DEV)                  (STAGING / QA)          (PRODUCTION)
hotfix/<issue>-name ─────────────────────────────── PR ───────────────────────► main, then back into develop
```

| Branch | Purpose | Merges in from |
|---|---|---|
| `main` | Production. Every merge is tagged. | `staging` (release) or `hotfix/*` |
| `staging` | Release candidate, tested before production | `develop` |
| `develop` | Latest integrated work | `feature/*`, `fix/*` |

**Rules**
- Nobody pushes directly to `develop`, `staging` or `main`. Every change is a pull request with a green **CI** check.
- One branch per issue: `feature/12-chart-of-accounts`, `fix/40-rounding`, `hotfix/51-login`.
- [Conventional Commits](https://www.conventionalcommits.org) with the issue number: `feat(accounts): add account codes (#12)`.
- Every PR links its issue (`Closes #12`), fills in the template and is reviewed against [CODE_REVIEW.md](CODE_REVIEW.md).

## Workflow

1. Pick an issue from the board (or open one) and assign yourself.
2. `git switch develop && git pull`
3. `git switch -c feature/<issue>-<short-name>`
4. Commit small, focused steps. Run `npm run lint` and `npm test` before pushing.
5. Open a PR **into `develop`**. Ask for a review. Merge when CI is green and the review is approved.

## Releasing

1. PR **`develop` → `staging`** titled `Release vX.Y.Z`; test on staging.
2. Fix issues with `fix/*` PRs into `staging`, then merge `staging` back into `develop`.
3. PR **`staging` → `main`**, then tag `vX.Y.Z` and publish release notes.

## Project rules

- **Money** is always stored as an integer in the smallest currency unit. Never use floating point for amounts.
- **Organisation isolation:** read and write organisation data through `TenantPrisma`, never `PrismaService`. It adds the current organisation to every query. New tables with an `organizationId` must be added to `TENANT_MODELS` (a test enforces this).
- **Permissions:** every endpoint requires sign-in unless marked `@Public()`, and declares what it needs with `@RequirePermission(...)`. Rules live in `packages/shared` so the web app and API agree.
- **Text:** every user-facing string goes through i18n. No hard-coded English in components.
- **Animations:** only animate `transform` and `opacity`, and respect `prefers-reduced-motion`.
- **Data:** use demo data only. Never commit real customer or financial data, or secrets.

## Adding or changing text

1. Add the English text to `apps/web/src/i18n/locales/en.json`.
2. Add the same key to **every** other language file. CI fails if a key is missing, empty, or has different `{{placeholders}}`.
3. Not a native speaker? Add your best translation and open the PR with the `i18n` label so a native speaker can review it.
