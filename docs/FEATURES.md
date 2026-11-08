# LedgerNest feature list

LedgerNest is accounting software for any business: a shop, a clinic, a school, an agency, a factory or a non-profit. It is built in phases. Each feature becomes a GitHub issue, and each issue ships through a pull request.

Status: ✅ done · 🚧 in progress · 📋 planned

## Phase 1: Platform, identity and access (foundation)

| Feature | What it means | Status |
|---|---|---|
| Super Admin console | Platform owner manages every organisation, user and global setting | 📋 |
| Organisations (multi-tenant) | Each business is a separate organisation; data is always isolated by organisation | 📋 |
| Sign-in and sessions | Email + password (hashed with Argon2), short-lived access token, rotating refresh token, account lockout | 📋 |
| Roles and permissions | Built-in roles (below) plus **custom roles** built from a permission matrix | 🚧 Rules done (#3) |
| Invitations | Invite people to an organisation by email with a role; accept, resend, revoke | 📋 |
| Audit log | Who did what, when and from where, for every change to financial data and access | 📋 |
| Multi-language | English, हिन्दी, मराठी, Español, Français, Deutsch and العربية (right-to-left), switchable at any time | ✅ (#5) |
| Localisation | Numbers, currencies, dates and fiscal years follow each organisation's locale | 🚧 Numbers and money done (#5) |
| Motion system | Smooth, GPU-friendly animations that run at the display's refresh rate (60–240 Hz) and respect "reduce motion" | ✅ (#4) |
| Light and dark themes | System default, remembered per user | ✅ (#4) |

### Built-in roles

| Role | Level | Can do |
|---|---|---|
| **Super Admin** | Platform | Everything across all organisations: create/suspend organisations, manage platform users, view platform audit log |
| **Owner** | Organisation | Everything in their organisation, including billing settings and deleting the organisation |
| **Admin** | Organisation | Manage users, roles and settings; full accounting access |
| **Accountant** | Organisation | Full accounting: journals, period close, reports, tax |
| **Bookkeeper** | Organisation | Day-to-day entry: invoices, bills, payments, bank; cannot post to closed periods or change settings |
| **Auditor** | Organisation | Read-only access to all books, reports and the audit log |
| **Viewer** | Organisation | Read-only dashboards and reports |

## Phase 2: Core accounting

| Feature | What it means | Status |
|---|---|---|
| Chart of accounts | Assets, liabilities, equity, income and expenses, with sub-accounts and account codes | 📋 |
| Industry templates | Ready charts of accounts for retail, services, manufacturing, healthcare, education, non-profit, construction, restaurants, IT/software and agriculture | 📋 |
| Journal entries | Double-entry enforced (debits = credits), drafts, posting, reversal, attachments, memo | 📋 |
| General ledger | Every posted line per account with running balance and drill-down | 📋 |
| Trial balance | Balances of all accounts at any date | 📋 |
| Fiscal years and periods | Custom fiscal year start, monthly periods, **period lock** after close | 📋 |
| Multi-currency | Transactions in any currency, exchange rates, realised and unrealised gain/loss | 📋 |
| Taxes | Configurable GST / VAT / sales-tax rates and groups, tax on lines, tax summary | 📋 |

## Phase 3: Sales and purchases

| Feature | What it means | Status |
|---|---|---|
| Customers and vendors | Contacts with addresses, tax IDs, payment terms and balances | 📋 |
| Products and services | Items with prices, tax defaults and income/expense accounts | 📋 |
| Quotes → invoices | Branded PDF invoices, numbering, due dates, partial payments | 📋 |
| Recurring invoices | Weekly, monthly or yearly schedules | 📋 |
| Credit notes and refunds | Linked to the original invoice | 📋 |
| Bills and payments | Record vendor bills and payments made | 📋 |
| Aging reports | Who owes what, and for how long (receivables and payables) | 📋 |

## Phase 4: Banking

| Feature | What it means | Status |
|---|---|---|
| Bank and cash accounts | Multiple accounts and currencies | 📋 |
| Statement import | Upload CSV or OFX statements | 📋 |
| Reconciliation | Match statement lines to transactions, with suggestions | 📋 |
| Transfers | Between bank and cash accounts | 📋 |

## Phase 5: Reports and insights

| Feature | What it means | Status |
|---|---|---|
| Dashboard | Cash, receivables, payables, profit trend and alerts | 📋 |
| Profit & loss | By period, compare periods, by cost centre | 📋 |
| Balance sheet | At any date, with comparison | 📋 |
| Cash flow statement | Direct and indirect methods | 📋 |
| Tax reports | GST / VAT summaries for filing | 📋 |
| Export | PDF, Excel (XLSX) and CSV for every report | 📋 |

## Phase 6: Advanced

Budgets · cost centres and projects · inventory · fixed assets and depreciation · approval workflows · document attachments · data import from spreadsheets · public API keys and webhooks · scheduled reports · backups and restore.

## Quality standards (apply to every feature)

- **Security:** organisation data isolation on every query, role checks on every endpoint, input validation, OWASP Top 10, audit log.
- **Accuracy:** money stored as integers in the smallest unit (no floating-point rounding errors); every posting balanced; posted entries are never edited, only reversed.
- **Accessibility:** WCAG 2.2 AA: keyboard support, screen-reader labels, colour contrast.
- **Performance:** animations use only `transform` and `opacity`; large tables are virtualised; code is split per page.
- **Testing:** unit tests for rules, API tests for every endpoint, end-to-end tests for key flows.
- **Free to run:** GitHub, GitHub Actions and Pages, Neon (PostgreSQL) and Render free tiers.
