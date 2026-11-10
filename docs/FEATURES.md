# LedgerNest feature list

LedgerNest is accounting software for any business: a shop, a clinic, a school, an agency, a factory or a non-profit. It is built in phases. Each feature becomes a GitHub issue, and each issue ships through a pull request.

Status: ✅ done · 🚧 in progress · 📋 planned

## Phase 1: Platform, identity and access (foundation)

| Feature | What it means | Status |
|---|---|---|
| Super Admin console | Platform owner manages every organisation, user and global setting | ✅ #10 |
| Organisations (multi-tenant) | Each business is a separate organisation; data is always isolated by organisation | 📋 |
| Sign-in and sessions | Email + password (hashed with Argon2), short-lived access token, rotating refresh token, account lockout | ✅ #7 |
| Two-factor sign-in | Authenticator-app codes (TOTP, RFC 6238) after the password: set up by scanning a QR code, ten one-time recovery codes (stored hashed), each code accepted once, wrong codes count toward the lockout; the secret is encrypted at rest; turning it off needs the password and a code | ✅ |
| Require two-factor for everyone | An organisation setting (Owners and Admins, who must use two-factor themselves first): members without it see a page asking them to set it up and the API refuses their requests with two_factor_required until they do; API keys are unaffected | ✅ |
| Where you're signed in | Every device or browser signed in to your account ("Chrome on Windows", "Safari on iPhone"), with its address and when it was last used, this one first; sign any other one out (audited) | ✅ |
| Passwords | Forgotten passwords reset by an emailed link (works once, for 30 minutes, the same answer whether or not the address has an account); change your own password from the account menu (other devices signed out); sign out of every device | ✅ |
| Deleting data (DPDP) | Owners delete an organisation and all its books after typing its name, with a backup offered first and a platform audit entry kept; anyone deletes their own account with their password: name and email erased and sign-in disabled, while what they recorded stays (accounting records must be kept), shown as a deleted user. An organisation's only Owner hands it over first | ✅ |
| Roles and permissions | Built-in roles (below) plus **custom roles** built from a permission matrix | ✅ #11 |
| Invitations | Invite people to an organisation by email with a role; accept, resend, revoke | ✅ #11 |
| Audit log | Who did what, when and from where, for every change to financial data and access | ✅ Done (#12) |
| Multi-language | English, हिन्दी and मराठी, switchable at any time. Spanish, French, German and Arabic (right-to-left) are kept in `apps/web/src/i18n/locales` but not offered while the app is India-only | ✅ (#5) |
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
| Invoices | Printable (PDF) GST invoices with your terms and bank details at the foot, emailed to the customer as a PDF, numbering, due dates, place of supply; receipts against one or many invoices, with advances and realised exchange differences | ✅ #66, #69 |
| Pay by UPI | Set the organisation's UPI ID once: every rupee invoice with something still owed then carries a UPI QR code for the balance (on screen, in the PDF, in the emailed invoice and in reminders) that Google Pay, PhonePe, Paytm, BHIM or any bank app scans with the amount and invoice number filled in. No gateway, no fees, money straight to the bank | ✅ |
| Invoice links and WhatsApp | Share an issued invoice as a private link the customer opens without an account: what's owed and when, a Pay by UPI button and QR code, the PDF, the full invoice, in English, Hindi or Marathi. Sent with one tap on WhatsApp (to the customer's mobile when it's on file) with the message written; the invoice shows when the customer opened it; links can be turned off, stop when the invoice is voided, and are never copied into restored backups | ✅ |
| Customer account links | One private link per customer showing every invoice they still owe, with its due date, state and PDF, the total per currency, and one UPI QR code that pays the whole rupee balance at once. Sent on WhatsApp from the contact page with the message written; shows how often it was opened; can be turned off; never copied into restored backups | ✅ |
| Quotes | Estimates for customers, priced with the same lines and GST rules as invoices; sent, accepted or declined, expired past their date, emailed to the customer as a PDF, and turned into a draft invoice in one step | ✅ |
| Recurring bills | Rent, subscriptions and other repeat bills made from a template on a schedule, as drafts or recorded, catching up on missed dates; approvals still apply | ✅ |
| Credit limits | A most-owed amount per customer, in their currency; the customer page shows how much is used, and an invoice that would go over it shows a warning before saving or issuing | ✅ |
| Weekly summary | Owners and Admins can get an email every Monday: cash, what's owed either way, profit this year and what needs attention | ✅ |
| Payment reminders | Email a customer what's still owed on an invoice, when it was due and what's been paid, with an optional note; the invoice shows how many reminders went and when; or automatically for overdue invoices, some days after the due date, then every so many days, up to a limit | ✅ |
| Recurring invoices | Weekly, monthly, quarterly or yearly schedules from a template invoice, ending on a date or after a count, raised as drafts or issued, with what's coming next | ✅ #71 |
| Credit notes and refunds | Against the original invoice (some or all of its lines, tax included); the credit comes off the invoice, then goes onto another invoice or is refunded | ✅ #67 |
| TDS on vendor payments | Tax deducted at source when paying contractors, professionals and landlords: section (194C, 194J, 194I, 194H, 194Q, 194A) with its usual rates suggested, worked out on the bills before GST, kept back from the bank and owed on TDS payable while the bills settle in full; a TDS report by section (Form 26Q) and month with the day it's due (challan 281), each deductee's PAN, and the deposit on the dashboard's due dates | ✅ |
| TDS kept back by customers | Receipts where the customer paid less because they kept TDS back: the invoices settle in full, the bank gets what arrived, and the TDS goes to TDS receivable to claim against Form 26AS; the receipt PDF shows it, and the TDS report has a Kept back by customers side with each customer's PAN | ✅ |
| MSME 45-day rule | Vendors carry their Udyam number and MSME category; bills from micro and small enterprises get their legal pay-by date (the agreed date, at most 45 days from the bill, or 15 days with no agreement, under MSMED Act section 15). An MSME payments report shows what's overdue, due within the week, paid late, and the taxable value at risk of being disallowed under income-tax section 43B(h) if still unpaid at the year end; the dashboard warns before the deadline | ✅ |
| Balance confirmations | For the audit: every customer or vendor with a balance on a day (usually the year end) gets a link, by email or WhatsApp, showing that balance as our books have it, with the statement behind it; they agree, or dispute with their own figure and a note, without an account. Answers, who gave them and how often each link was opened are listed under Reports, in English, Hindi or Marathi | ✅ |
| Cheque printing | A vendor payment printed onto a standard CTS-2010 cheque leaf: the date in its eight boxes, the payee, the amount in Indian words over two lines and in figures guarded with ** and /-, crossed A/c Payee by default; for what the bank pays after TDS. The print can be nudged in millimetres for the printer, remembered on the device | ✅ |
| Debit notes (purchase returns) | Some of a recorded bill's lines sent back or credited, with the supplier's own credit note number: the expense and its input GST come back off, the credit comes off the bill first, and what's left stays with the vendor to apply to their other bills or have refunded into a bank; voidable until refunded; in payables aging, vendor statements, GSTR-3B and the Tally export (as Debit Note vouchers). Rupee bills; goods kept in stock go back with a stock adjustment | ✅ |
| Bills and payments | Vendor bills with input GST to expense or asset accounts, and payments against one or many bills | ✅ #68, #69 |
| Aging reports | Who owes what, and for how long (receivables and payables), at any date, with each document and CSV export | ✅ #70 |
| Statements of account | A customer's or vendor's invoices, credit notes, bills, payments and voids over some dates, with the balance brought forward, a running balance and the balance carried down, per currency; CSV, Excel or PDF, or emailed to the contact as a PDF | ✅ |
| Sales and purchases | Invoiced sales (less credit notes) and recorded purchases over some dates, by customer, vendor or item, with quantities, net, tax and total in the base currency; CSV or Excel | ✅ |

## Phase 4: Banking

| Feature | What it means | Status |
|---|---|---|
| Bank and cash accounts | Every account with its balance (in its own currency too) and a statement of what moved; money spent and received that isn't an invoice or bill, with GST | ✅ #90 |
| Statement import | CSV (layout worked out, correctable, remembered per account) or OFX, previewed first; the same lines never import twice | ✅ #92 |
| Reconciliation | Bank lines matched to the books with suggestions, missing entries recorded from the bank line, reconciled to a statement balance and locked | ✅ #93 |
| Receipts from bank lines | Money in that pays an open invoice is spotted while reconciling: by the invoice number a UPI QR payment's note carries (however the bank writes it), or the exact balance from a customer named in the narration; one click records the receipt, dated and referenced as the bank has it, and matches it | ✅ |
| Transfers | Between bank and cash accounts, across currencies with the exchange difference booked | ✅ #91 |

## Phase 5: Reports and insights

| Feature | What it means | Status |
|---|---|---|
| Dashboard | Cash, receivables, payables and profit from the books, twelve months of profit, and alerts (overdue, to reconcile, recurring due, months open, drafts) | ✅ #105 |
| Cash forecast | 13 weeks ahead from today's cash: unpaid invoices on the day each customer usually pays (learned from their last year of paid invoices), unpaid bills on their due dates, and what repeat invoices and bills will raise; the balance at the end of each week as a chart and a table with what moves in it, a warning for the first week cash runs short, and the customers who pay late. On the dashboard too | ✅ |
| Due dates | India's regular filing and payment dates on the dashboard: GSTR-1 (11th), GSTR-3B (20th, with the tax it would put in cash so far), GSTR-9 (31 December) and the four advance-tax instalments, with days left or late, each opening that period's report | ✅ |
| Late fees on GST returns | A GSTR-1 or GSTR-3B past its due date shows what filing it today costs, if it hasn't been filed: the late fee at ₹50 a day (₹20 for a nil return, worked out from whether there was anything in the month), capped by last year's turnover (₹500 nil, ₹2,000 up to ₹1.5 crore, ₹5,000 up to ₹5 crore, ₹10,000 above), and interest at 18% a year on GSTR-3B's cash tax | ✅ |
| Profit & loss | By period with sub-accounts in their parents, beside the previous period, last year, month by month or cost centre | ✅ #102 |
| Balance sheet | At any date, current and non-current, unclosed profit in equity, beside another date | ✅ #103 |
| Cash flow statement | Direct and indirect methods, agreeing with opening and closing cash | ✅ #104 |
| Tax reports | Tax summary by rate; GSTR-3B with set-off and GSTR-1 (B2B, B2C, exports, credit notes, HSN), JSON for the GST portal | ✅ #106 |
| GST e-invoices | Issued invoices to registered buyers as e-invoice JSON (NIC schema 1.1) for the Invoice Registration Portal, one at a time or a date range in bulk; what the portal would refuse (GSTINs, addresses, PIN codes, HSN on each line) is listed with where to fix it first | ✅ |
| E-way bills | An issued invoice's goods (services left out) as JSON for the e-way bill portal's bulk generation, for consignments over ₹50,000: registered or unregistered buyers, IGST or CGST + SGST rates per item, the main HSN code, and Part B (vehicle number, or the railway, air or shipping document) filled now or left for the portal; distance left at 0 lets the portal work it out from PIN codes. What the portal would refuse is listed with where to fix it | ✅ |
| GST health check | What would go wrong when filing, found first: your GSTIN and address, items without HSN or SAC codes, customers without a state (exports excluded), registered customers missing e-invoice details, vendors charging GST without a GSTIN on file; each with examples and where to fix it | ✅ |
| GSTR-2B reconciliation | Upload GSTR-2B JSON from the GST portal and match every supplier invoice to the bills: matched (numbers written loosely, rupee rounding allowed), amounts differing (taxable value, tax, or IGST against CGST + SGST), probable matches with the number typed differently, filed but missing from the books, and booked but not filed by the supplier (input credit at risk), with the tax at stake and a CSV. Nothing is stored | ✅ |
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
| Move from Tally | Tally's List of Accounts exported as XML (UTF-16 or UTF-8) in one step: ledgers become accounts by their Tally group (custom groups followed up to Tally's own), Sundry Debtors and Creditors become customers and vendors with GSTIN, address, state, PIN code, phone, email and credit days, and opening balances become a draft entry (party balances as Debtors and Creditors totals). Accounts already in the chart are matched by name; nothing is saved if accounts or parties wouldn't import | ✅ |
| API keys and webhooks | Scoped API keys shown once and revocable, acting within their maker’s permissions; signed webhooks for invoice, payment and bill events with retries and a delivery log | ✅ #142 #143 |
| Scheduled reports | Profit and loss, balance sheet, trial balance and aging made weekly or monthly as Excel, CSV or PDF, kept in the app and emailed to members who can see reports | ✅ #145 |
| Tally Prime export | For accountants who keep clients in Tally: ledgers under Tally's own groups (Sundry Debtors and Creditors for customers and vendors, Duties & Taxes for GST, Bank Accounts…), and each posted entry in some dates as a Sales, Purchase, Receipt, Payment, Contra, Credit Note or Journal voucher, with customer and vendor lines on their own ledgers; every download audited | ✅ |
| Backups and restore | An organisation’s books downloaded as one JSON file and restored as a new organisation, checked before anything is written; Owners only | ✅ #147 |

## Quality standards (apply to every feature)

- **Security:** organisation data isolation on every query, role checks on every endpoint, input validation, OWASP Top 10, audit log.
- **Accuracy:** money stored as integers in the smallest unit (no floating-point rounding errors); every posting balanced; posted entries are never edited, only reversed.
- **Accessibility:** WCAG 2.2 AA: keyboard support, screen-reader labels, colour contrast.
- **Performance:** animations use only `transform` and `opacity`; large tables are virtualised; code is split per page.
- **Testing:** unit tests for rules, API tests for every endpoint, end-to-end tests for key flows.
- **Free to run:** GitHub, GitHub Actions and Pages, Neon (PostgreSQL) and Render free tiers.
