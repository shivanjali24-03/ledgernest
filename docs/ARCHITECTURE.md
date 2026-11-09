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

## Super Admin console

Platform endpoints live under `/api/v1/platform` and need a platform permission, so only Super Admins can use them. Every change is written to the audit log with before and after values.

- **Organisations:** search and filter, create, edit, suspend (members are locked out at once) and reactivate. A web address (slug) is generated from the name and made unique automatically.
- **First Owner:** if the email already has an account, they're added as Owner straight away. Otherwise an invitation is created and its one-time link is returned to the Super Admin to share. Email delivery comes later.
- **Platform users:** search, promote to or demote from Super Admin, suspend (ending their sessions at once) and reactivate. LedgerNest always keeps at least one active Super Admin. These changes run under a database lock, so two admins demoting each other at the same instant can't both succeed.
- **Stats:** organisations and users by status, sign-ins in the last 7 days, and recent platform activity.

## Chart of accounts

- `GET/POST /api/v1/accounts`, `PATCH/DELETE /accounts/:id`, `POST /accounts/:id/archive` and `/restore`. Reading needs `accounts.view`; changes need `accounts.manage` and are audited (`org.account.*`).
- **Types:** asset, liability, equity, income and expense, each with a normal side (debit or credit) and sub-types used by reports (bank, receivables, cost of sales…).
- **Codes** (letters, digits, dots, dashes; up to 12) are unique per organisation and sorted numerically: 200 < 1100 < 1100.2 < 1100.10. **Names** are unique ignoring case.
- **Sub-accounts** go up to 4 levels and share their parent's type. Moving an account checks the whole subtree: no loops, no fifth level.
- **The database enforces the essentials as well:**
  - A composite foreign key keeps a parent in the same organisation, and a trigger keeps the types equal.
  - Check constraints validate the type and code, and a case-insensitive unique index covers names.
- **System accounts** (retained earnings, opening balance equity) are created with every organisation, named in its language. They can be renamed but not re-typed, archived or deleted.
- **Archive, don't delete:** archiving hides an account from new entries and keeps its history (sub-accounts first; restoring goes parent first). Deleting is only for unused accounts without sub-accounts. Journal entries (#42) will add "has entries" to these checks.
- Writes take a per-organisation advisory lock, so two people creating the same code at once get one account and a clear `code_taken`, never a database error.
- **Industry templates** (`GET /accounts/templates/:industry`, `POST …/apply`): 10 industries, 32–35 accounts each (a shared Indian small-business base plus each industry's own accounts), named in all 7 languages.
  - They're applied in the organisation's language, and only to a chart that holds nothing but the system accounts, so a template never overwrites real work.
  - A Super Admin can pick one when creating an organisation. A shared test checks every template: valid codes, same-type parents, at most 4 levels, all five types, and names unique in every language.
- **Screen** (`/accounts`):
  - Accounts are grouped by type as an expandable tree. Search matches codes and names and keeps each match under its parents.
  - Filters for type and archived accounts live in the address bar.
  - The add/edit dialog only offers parents of the same type with room beneath them, never the account itself or its sub-accounts, and suggests the next free code.
  - Refusals from the API are shown next to the field they're about.

## Reports: trial balance and general ledger

- `GET /api/v1/reports/trial-balance?asOf=` and `GET /reports/ledger?accountId=&from=&to=` (`reports.view`). Their `/export` CSV versions need `reports.export`, and amounts use the currency's own decimals.
- Only posted entries count. Sums are computed in PostgreSQL. The ledger is a single SQL join, because loading entries per line through the ORM sends every line ID as a parameter and broke at 50,000 lines.
- A test posts 100,000 lines: the trial balance answers well inside 2 seconds and the ledger inside 5.
- Ledger balances are shown on the account's normal side (a bank's money in hand is positive, and so is an income account's earnings), with the balance carried in from before the range.
- **Screen:** the trial balance is grouped by type with a "Debits equal credits" check, and each account opens its ledger. The ledger has a running balance and a link to every entry.

## Journal entries

- `GET/POST /api/v1/journals`, `GET/PATCH/DELETE /journals/:id`, `POST /journals/:id/post`, `/reverse`, and `/attachments`.
- **Permissions:** `journals.view` to read, `journals.create` for drafts and documents, and `journals.post` and `journals.reverse` for those actions.
- **Amounts** are integers in the smallest currency unit (`BIGINT`), so totals never round. Each line is a debit or a credit, never both.
- **Drafts** can be saved unbalanced. Posting checks at least two lines, debits equal to credits, active accounts of this organisation, and a date in an open month of an existing financial year. It then assigns a gap-free number per year (`JV/2026-27/0007`) under a per-organisation lock.
- **Posted entries are final.** A reversal posts the exact opposite on a date of your choice (which must be in an open month, so a closed month is corrected from a later one) and links both entries. An entry is reversed at most once, and a reversal can't be reversed.
- **The database enforces the same:**
  - Triggers refuse posting an unbalanced entry or one dated in a closed month.
  - They refuse any change to a posted entry or its lines, and any deletion. Deleting the whole organisation is the only exception.
  - Composite foreign keys keep lines on the organisation's own accounts.
- **Attachments:** PDF or images up to 2 MB, checked by their bytes and stored with a type and size check. They're served as downloads with a locked-down CSP, and only a draft's can be removed.
- **Side effects:** accounts used by entries can't be deleted or re-typed, and the base currency locks once anything is posted.
- **Screens:** the list is in the organisation's currency and number format (₹1,18,000.00). The editor shows live totals, an "Out by" indicator and accounts grouped by type. A posted entry shows its reversal links and attachments.

## Financial years and periods

- `GET/POST /api/v1/fiscal-years`, `POST /fiscal-years/periods/:id/close` and `/reopen`. Reading needs `accounts.view`. Adding years and closing need `periods.close`, reopening needs `periods.reopen`. Each change is audited.
- A financial year starts in the organisation's start month and is split into 12 calendar-month periods. Dates are calendar days (`YYYY-MM-DD`), and "today" is worked out in the organisation's time zone.
- **Contiguous years:** a new year must directly follow the last or directly precede the first (for entering history). PostgreSQL exclusion constraints guarantee that years, and periods, never overlap.
- **Closing order:** periods close in order (the earliest open one) and reopen in reverse (the latest closed one), with an optional reason. "Everything up to date X is final" is then always true.
- `PeriodsService.dayStatus()` tells journal entries (#42) whether a day is open, closed or outside every year.
- Once a financial year exists, the organisation's fiscal-year start is locked in settings.

## Organisation settings

- `GET /api/v1/organization` returns the settings, what can no longer change (`locks`) and your access. `PATCH` changes them, with `org.settings.manage` (Owners and Admins).
- **Company details:** legal name, tax ID (GSTIN, VAT…), contact email and phone, and address.
- **Money and dates:** base currency (any ISO 4217 code), locale for number and date formats, IANA time zone, and the fiscal year start month.
- The **time zone** decides which calendar day a moment belongs to, so period boundaries and report dates follow the business, not the server. New organisations get their country's zone.
- Only values that actually change are written, and each change is audited before → after (`org.settings.update`). The web address (slug) is changed only by Super Admins.
- **Locks:** the base currency can't change once journal entries exist, and the fiscal year start can't change once fiscal years exist. The response says which are locked, so the screens can explain it.
- **Logo** (`PUT/GET/DELETE /organization/logo`):
  - PNG, JPEG or WebP up to 256 KB, sent as base64. The file's first bytes must match its claimed type, and SVG is refused because it can carry scripts.
  - Stored in its own table, so organisation queries never load image bytes. A database check repeats the type and size rules.
  - Served with `nosniff` and a locked-down Content-Security-Policy.
  - Only the logo route accepts bodies over the usual 100 KB.
- **Settings page** (`/settings`):
  - One form in three sections. A save bar appears only with unsaved changes, and only changed fields are sent.
  - The same shared rules as the API run before saving, so problems show next to the field.
  - Leaving with unsaved changes asks first, both in the app and when closing the tab.
  - Locked settings are shown disabled with the reason, and people with view-only access see a read-only page.
  - The logo is checked in the browser with the same rules as the API, then fetched with the access token and shown from an object URL.

## Audit log

- Every sign-in, admin change and Super Admin support visit is recorded: who, what, when, from which IP and browser, with before and after values.
- **Append-only, enforced by PostgreSQL.** Database triggers refuse any `UPDATE`, `DELETE` or `TRUNCATE` on `audit_logs`, whatever the application does. The only allowed change is the database clearing `actor_id` or `organization_id` when that user or organisation row is deleted.
- **Who it was is never lost:** a trigger copies the actor's email into the entry when it's written, so it survives even if the user is later deleted.
- **Organisations** see their own log (`GET /api/v1/organization/audit`, needs `audit.view`): team and role changes, invitations, exports, and every Super Admin support visit to their data.
- **Super Admins** see everything (`GET /api/v1/platform/audit`), including sign-ins, and can narrow it to one organisation.
- Filters: kind of action, person, organisation and date range. Paging uses a cursor on (time, id), so it stays stable while new entries arrive.
- **CSV export** of up to 10,000 entries. Cells that a spreadsheet would run as a formula are neutralised, and every export is itself recorded.
- `GET …/audit/actors` lists the people who appear in a log, for the person filter.
- **Screens:** *Audit log* (organisation) and *Platform audit log* (Super Admins). Entries are grouped by day in the reader's time zone, and each expands to show when, IP address, device and a field-by-field **before → after** comparison. Permission changes show exactly what was added and removed. Filters live in the address bar, so a filtered view can be shared as a link. Date filters turn the reader's local days into exact UTC instants before calling the API. On phones the comparison stacks instead of scrolling sideways.
- The demo has its own realistic history, with the same actions and before/after shapes as the API, and checks the previewed role just like the real log.
- Note for development: because the log is append-only, test runs leave audit entries in the test database. That's expected, and tests never depend on them.

## Team management

An organisation's own admins manage their team under `/api/v1/organization` (`members`, `invitations`, `roles`). One rule runs through all of it: **nobody can grant more access than they have.**

- To change someone's role, you must be allowed to give both their **current** role and the **new** one. So an Admin can't demote an Owner or promote anyone to Admin, and only an Owner can make another Owner.
- Custom roles rank below Admin, and you can only build or edit a role from permissions you hold yourself.
- Every organisation keeps at least one Owner, checked under a per-organisation database lock.
- Nobody changes their own role or removes themselves, so nobody locks themselves out by accident.
- Editing a custom role changes its members' access on their next request.
- A role still assigned to people can't be deleted. Deleting one withdraws its pending invitations.
- Resending an invitation issues a new link and kills the old one, and a revoked link stops working at once.
- Refusals include a `details.reason` (`exceeds_your_access` with the `missing` permissions, `last_owner`, `self`, `already_member`, `already_invited`, `name_taken`, `in_use`) so the web app can explain them in any language.

## Invitations

- The link holds a random token. Only its hash is stored, it expires after 7 days and it works once. Tokens travel in request bodies, never in URLs, so they don't end up in server logs.
- **New people** accept on the public page by choosing a name and password, and are signed in straight away.
- **People who already have an account** accept while signed in, and only for their own email. The public page can't be used to guess an existing account's password around the sign-in lockout.
- The invitation is claimed before anything else happens, so a double click can't create two accounts.

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

How a request is checked:

1. **Signed in?** Every endpoint requires a valid access token unless marked `@Public()`. The user is re-read from the database on each request, so a suspension or a removed Super Admin takes effect at once.
2. **Which organisation?** Organisation endpoints need an `X-Organization-Id` header. If the caller isn't a member, the answer is `404 Organisation not found`, the same as for an id that doesn't exist, so outsiders can't probe which organisations exist.
3. **Allowed?** `@RequirePermission('users.view')` is checked against the caller's role there. A `403` lists the missing permission. Platform permissions (`platform.*`) are only for Super Admins and can't be granted by an organisation role, even a custom one.
4. **Scoped data.** The organisation is stored for the rest of the request. `TenantPrisma` adds it to every query on organisation tables (reads, updates, deletes and creates), overriding anything the code passes in. Without an organisation it refuses to run.

**Support access:** a Super Admin can open any organisation, including suspended ones, to help a customer. Each such request is written to the audit log as `platform.support_access` with the method and path.

## Accounting rules

- Amounts are integers in the smallest currency unit (e.g. paise, cents).
- A journal entry must have at least two lines, and debits must equal credits.
- Posted entries are immutable: corrections are made with a reversing entry.
- Periods can be locked; nothing posts into a locked period.
- **Year-end close.** Closing a year's last month closes the year: first a closing entry on its last day brings every income and expense account to zero against Retained earnings, so a year can never be closed without its result moved. Reopening that month reverses the closing entry (posted entries are never edited), and the closing entry can't be reversed any other way.

## Taxes

- **Rates in parts per million.** 18% is stored as 180000 and CGST on the 0.25% slab (0.125%) as 1250, so tax maths is integer-only like money.
- **Rates and groups.** A rate is one component (CGST 9%) with the accounts it posts to: a liability for tax on sales and an asset (input credit) for tax on purchases. A group bundles rates and is what a line picks (GST 18% = CGST 9% + SGST 9%). Percentages and a group's rates never change once created, so what an entry was taxed at can't shift underneath it.
- **GST slabs (India).** A platform-wide table the Super Admin manages. A slab's rate never changes; when the GST Council changes rates, the old slab gets an end date and a new one starts. The database refuses two slabs of the same rate in force on the same day (an `EXCLUDE` constraint), and a slab an organisation uses can only be retired, not deleted.
- **GST setup.** One step creates the input and output accounts (reusing the industry template's 1300/2100 accounts), the rates, and for each slab an intra-state group (half CGST, half SGST) and an inter-state group (IGST at the full rate). Union Territories without a legislature (Chandigarh, Ladakh, Lakshadweep, Andaman and Nicobar, Dadra and Nagar Haveli and Daman and Diu) get UTGST instead of SGST, decided from the organisation's state. Running it again only adds what's missing.
- **Tax on lines.** A line picks a tax group and says whether its amount includes the tax. The API stores the line at its net value, followed by one generated line per tax component on the same side, so the entry still balances like any other. Sales (income) post output tax; purchases (expenses, assets) post input credit; a credit note runs the other way on the same account and so reduces the same tax. Each component is rounded on its own, as GST invoices show them; for an inclusive amount the net absorbs the rounding paisa so nothing is lost. Tax lines are recomputed when a draft posts, and a reversal mirrors them exactly. A database check keeps every tax line tied to its rate and the line it was charged on.
- **Tax summary.** Per group, the taxable value and tax of outward and inward supplies; per rate, output tax, input credit and the net payable, for any date range, with CSV export.

## Currencies

- **Base currency and foreign currencies.** The books are kept in the organisation's base currency. Foreign currencies are enabled per organisation; the base currency can't be one of them.
- **Exchange rates.** "1 unit of the foreign currency = rate units of the base currency" on a day, stored as `NUMERIC(20,10)` and handled as decimal strings; conversion to the base currency is integer-only and rounds half away from zero. A day without a rate uses the latest earlier one.
- **Where rates come from.** Typed by hand, or fetched from the European Central Bank's free reference rates through Frankfurter (`FX_RATES_URL`, no key). The ECB publishes on working days, so a fetched rate is saved on the day it was published. A rate typed by hand is never overwritten by a fetch, and currencies the ECB doesn't cover (e.g. AED, SAR) are reported so they can be entered by hand. The network calls happen before the database transaction, never inside it.
- **Foreign-currency accounts and lines.** An asset or liability account can be kept in an enabled foreign currency (a USD bank account, a USD receivable). Its lines are entered in that currency and stored with the foreign amount, the rate and the base amount; other accounts stay in the base currency. A composite foreign key makes the database refuse a line whose currency isn't its account's.
- **Realised exchange differences.** A foreign account carries its balance at an average rate. When a line reduces the balance (a receivable collected, a payable paid), the carrying amount of the settled part is taken out; if that differs from the line's own base amount, a generated pair of lines adjusts the account and books the difference to *Realised exchange gain or loss*. This happens when the entry posts; a reversal mirrors the original's lines instead.
- **Revaluation.** `POST /currencies/revalue` moves every foreign account to a day's rate in one entry, booking to *Unrealised exchange gain or loss*. Later settlements realise only what moved after it. Both exchange accounts are system accounts created the first time they're needed.

## Decisions

Architecture decision records live in [`docs/adr`](adr).
