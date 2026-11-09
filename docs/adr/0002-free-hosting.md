# 0002: Free hosting on GitHub Pages, Render and Neon

**Status:** accepted

## Context

LedgerNest must run on free resources only, with production, staging and development environments.

## Decision

- **Web:** GitHub Pages. Every deploy builds all environments into one site under `/ledgernest/`, `/staging/`, `/dev/` and `/demo/`.
- **API:** one Render free web service per environment, defined in `render.yaml`.
- **Database:** Neon free plan, one project with a database branch per environment.

## Consequences

- Nothing to pay and nothing to run ourselves. Branch merges deploy automatically.
- The web app and API are on different sites, so the refresh cookie must be `SameSite=None; Secure; Partitioned`. Browsers that refuse it lose the session on reload.
- Free Render services sleep when idle, so the first request can take up to a minute. The app explains the wait.
- Rebuilding every environment on each deploy takes a few minutes, but the published site is always consistent.
- A custom domain later would put web and API on one site and remove the cross-site cookie concern.
