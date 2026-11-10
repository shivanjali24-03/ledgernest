# LedgerNest feature list

LedgerNest is accounting software for any business: a shop, a clinic, a school, an agency, a factory or a non-profit. It is built in phases. Each feature becomes a GitHub issue, and each issue ships through a pull request.

Status: ✅ done · 🚧 in progress · 📋 planned

## Phase 1: Platform, identity and access (foundation)

| Feature | What it means | Status |
|---|---|---|
| Super Admin console | Platform owner manages every organisation, user and global setting | ✅ #10 |
| Organisations (multi-tenant) | Each business is a separate organisation; data is always isolated by organisation | 📋 |
| Sign-in and sessions | Email + password (hashed with Argon2), short-lived access token, rotating refresh token, account lockout | ✅ #7 |
| Roles and permissions | Built-in roles (below) plus **custom roles** built from a permission matrix | ✅ #11 |
| Invitations | Invite people to an organisation by email with a role; accept, resend, revoke | ✅ #11 |
| Audit log | Who did what, when and from where, for every change to financial data and access | ✅ Done (#12) |
| Multi-language | English, हिन्दी, मराठी, Español, Français, Deutsch and العربية (right-to-left), switchable at any time | ✅ (#5) |
| Organisation settings | Company details, logo, base currency, locale, time zone and fiscal year start | ✅ #38 |
| Localisation | Numbers, currencies, dates and fiscal years follow each organisation's locale | ✅ Amounts follow the organisation's currency and format (#42) |
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
| Chart of accounts | Assets, liabilities, equity, income and expenses, with sub-accounts and account codes | ✅ #39 |
| Industry templates | Ready charts of accounts for retail, services, manufacturing, healthcare, education, non-profit, construction, restaurants, IT/software and agriculture | ✅ #40 |
| Journal entries | Double-entry enforced (debits = credits), drafts, posting, reversal, attachments, memo | ✅ #42 |
| General ledger | Every posted line per account with running balance and drill-down | ✅ #43 |
| Trial balance | Balances of all accounts at any date | ✅ #43 |
| Fiscal years and periods | Custom fiscal year start, monthly periods, **period lock** after close | ✅ #41, year-end close #58 |
| Multi-currency | Transactions in any currency, exchange rates (typed or fetched free from the European Central Bank), realised and unrealised gain/loss | ✅ #44 |
| Taxes | Configurable GST / VAT / sales-tax rates and groups, tax on lines, tax summary. India: the Super Admin keeps the GST slab list (0%, 0.25%, 3%, 5%, 18%, 40% since GST 2.0; 12% and 28% kept for older entries), and an organisation sets up CGST + SGST/UTGST and IGST groups in one step | ✅ #45 |

## Phase 3: Sales and purchases

| Feature | What it means | Status |
|---|---|---|
| Customers and vendors | Contacts with addresses, tax IDs (GSTIN checked, giving the state of supply), currency, payment terms, and what each owes or is owed | ✅ #64 |
| Products and services | Items with prices, tax defaults, HSN/SAC codes and income/expense accounts | ✅ #65 |
| Invoices | Printable (PDF) GST invoices, numbering, due dates, place of supply; receipts against one or many invoices, with advances and realised exchange differences | ✅ #66, #69 |
| Payment reminders | Email a customer what's still owed on an invoice, when it was due and what's been paid, with an optional note; the invoice shows how many reminders went and when | ✅ |
| Recurring invoices | Weekly, monthly, quarterly or yearly schedules from a template invoice, ending on a date or after a count, raised as drafts or issued, with what's coming next | ✅ #71 |
| Credit notes and refunds | Against the original invoice (some or all of its lines, tax included); the credit comes off the invoice, then goes onto another invoice or is refunded | ✅ #67 |
| Bills and payments | Vendor bills with input GST to expense or asset accounts, and payments against one or many bills | ✅ #68, #69 |
| Aging reports | Who owes what, and for how long (receivables and payables), at any date, with each document and CSV export | ✅ #70 |
| Statements of account | A customer's or vendor's invoices, credit notes, bills, payments and voids over some dates, with the balance brought forward, a running balance and the balance carried down, per currency; CSV, Excel or PDF, or emailed to the contact as a PDF | ✅ |

## Phase 4: Banking

| Feature | What it means | Status |
|---|---|---|
| Bank and cash accounts | Every account with its balance (in its own currency too) and a statement of what moved; money spent and received that isn't an invoice or bill, with GST | ✅ #90 |
| Statement import | CSV (layout worked out, correctable, remembered per account) or OFX, previewed first; the same lines never import twice | ✅ #92 |
| Reconciliation | Bank lines matched to the books with suggestions, missing entries recorded from the bank line, reconciled to a statement balance and locked | ✅ #93 |
| Transfers | Between bank and cash accounts, across currencies with the exchange difference booked | ✅ #91 |

## Phase 5: Reports and insights

| Feature | What it means | Status |
|---|---|---|
| Dashboard | Cash, receivables, payables and profit from the books, twelve months of profit, and alerts (overdue, to reconcile, recurring due, months open, drafts) | ✅ #105 |
| Profit & loss | By period with sub-accounts in their parents, beside the previous period, last year, month by month or cost centre | ✅ #102 |
| Balance sheet | At any date, current and non-current, unclosed profit in equity, beside another date | ✅ #103 |
| Cash flow statement | Direct and indirect methods, agreeing with opening and closing cash | ✅ #104 |
| Tax reports | Tax summary by rate; GSTR-3B with set-off and GSTR-1 (B2B, B2C, exports, credit notes, HSN), JSON for the GST portal | ✅ #106 |
| Export | CSV and Excel (XLSX) for every report, print or PDF with the organisation's details, every download audited | ✅ #107 |

## Phase 6: Advanced

| Feature | What it means | Status |
|---|---|---|
| Fixed assets and depreciation | A register with straight-line or written-down-value depreciation run monthly, disposals with gain or loss, and the asset schedule | ✅ #127 |
| Budgets | A plan per financial year by account and month, for the whole organisation or one cost centre, started from last year’s actuals, another budget or blank, and budget against actual with variances | ✅ #129 |
| Cost centres and projects | Journal, invoice, bill and bank lines tagged with a department or project; profit and loss by cost centre or for one | ✅ #131 |
| Inventory | Tracked goods bought on bills and sold on invoices at weighted average cost, cost of sales posted as stock leaves, adjustments with a reason, valuation beside the books | ✅ #134 |
| Approval workflows | Journal entries, bills, vendor payments and money spent from the bank at or above a set amount wait for someone else’s yes; approving posts them, sending back leaves a note | ✅ #136 |
| Document attachments | Receipts, PDFs and photos kept with journal entries, invoices, bills, payments and bank transactions; previewed, downloaded, checked by their bytes | ✅ #138 |
| Data import | Chart of accounts, contacts, items and opening balances from CSV or Excel: columns matched from the headers, every row checked before anything is saved | ✅ #140 |
| API keys and webhooks | Scoped API keys shown once and revocable, acting within their maker’s permissions; signed webhooks for invoice, payment and bill events with retries and a delivery log | ✅ #142 #143 |
| Scheduled reports | Profit and loss, balance sheet, trial balance and aging made weekly or monthly as Excel, CSV or PDF, kept in the app and emailed to members who can see reports | ✅ #145 |
| Backups and restore | An organisation’s books downloaded as one JSON file and restored as a new organisation, checked before anything is written; Owners only | ✅ #147 |

## Quality standards (apply to every feature)

- **Security:** organisation data isolation on every query, role checks on every endpoint, input validation, OWASP Top 10, audit log.
- **Accuracy:** money stored as integers in the smallest unit (no floating-point rounding errors); every posting balanced; posted entries are never edited, only reversed.
- **Accessibility:** WCAG 2.2 AA: keyboard support, screen-reader labels, colour contrast.
- **Performance:** animations use only `transform` and `opacity`; large tables are virtualised; code is split per page.
- **Testing:** unit tests for rules, API tests for every endpoint, end-to-end tests for key flows.
- **Free to run:** GitHub, GitHub Actions and Pages, Neon (PostgreSQL) and Render free tiers.
