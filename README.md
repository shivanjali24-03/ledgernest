<div align="center">

# LedgerNest

**Accounting for Indian businesses that want to get paid faster and file GST without the scramble.**

GST invoices with a UPI QR code, shared on WhatsApp, matched against GSTR-2B, with TDS, e-invoices, e-way bills and a Tally export for your CA. In English, हिन्दी and मराठी.

![React](https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white)

</div>

> **Status:** feature-complete for small and mid-sized Indian businesses; see the [feature list](docs/FEATURES.md) for everything that's done.

## Try it

| | |
|---|---|
| **Demo** (sample company, no sign-up, works offline) | https://shivanjali24-03.github.io/ledgernest/demo/ |
| **Production** | https://shivanjali24-03.github.io/ledgernest/ |
| Staging · Development | [/staging/](https://shivanjali24-03.github.io/ledgernest/staging/) · [/dev/](https://shivanjali24-03.github.io/ledgernest/dev/) |

The API runs on a free plan that sleeps when idle, so the first sign-in can take up to a minute. How it's hosted: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Why LedgerNest

**Built for how Indian businesses actually work:**

| | |
|---|---|
| **Get paid by UPI** | Every rupee invoice carries a UPI QR code for what's still owed: on screen, in the PDF, in emails and reminders. Any UPI app pays straight into your bank. No gateway, no fees. |
| **Send it on WhatsApp** | Share an invoice as a link your customer opens without an account, to pay by UPI or download the PDF. See when they opened it. Chase overdue invoices on WhatsApp in one tap. |
| **One link per customer** | Send a customer their own account link: every invoice they owe, each PDF, and one UPI code that pays the lot. |
| **GSTR-2B, matched** | Upload the portal's GSTR-2B and see which bills your suppliers haven't filed (credit at risk) before you claim it. |
| **Know your cash 13 weeks ahead** | The forecast learns how late each customer really pays, and warns you before cash runs short. |
| **Never miss a due date** | GSTR-1, GSTR-3B (with the tax to pay), GSTR-9, TDS deposits and advance tax on the dashboard, with days left. |
| **MSME 45-day rule** | Mark vendors as micro or small (Udyam) and see every bill's legal pay-by date, what's late, and what section 43B(h) would disallow at the year end. |
| **Cheque printing** | Print a vendor payment straight onto a cheque leaf: date boxes, payee, amount in words and figures, A/c Payee. |
| **TDS, both ways** | Keep TDS back from contractors and landlords (Form 26Q, challan dates), and record TDS your customers kept back (Form 26AS). |
| **e-Invoices, e-way bills and a health check** | e-Invoice JSON for the IRP and e-way bill JSON for moving goods, both checked before upload; a GST health check that finds missing HSN codes, states and GSTINs before filing. |
| **Your CA uses Tally?** | Export ledgers and vouchers as Tally Prime XML, party ledgers and all. |
| **On your phone** | Install it like an app; amounts in lakh and crore, and in words on invoices. |

**And the basics done properly:**

- **Works for any domain:** industry chart-of-accounts templates for retail, services, healthcare, education, manufacturing, non-profits and more.
- **Roles you can trust:** Super Admin, Owner, Admin, Accountant, Bookkeeper, Auditor and Viewer, plus custom roles.
- **Accurate by design:** money is stored as integers, every journal entry must balance, and posted entries are reversed, never edited.
- **Languages:** English, Hindi and Marathi. LedgerNest is built for India first; Spanish, French, German and Arabic (right-to-left) translations are kept for later and switched off.
- **Feels fast:** a motion system built for 60–240 Hz displays.

## What it does

- **Books:** chart of accounts with industry templates, journals that must balance, financial years with month and year-end close, multiple currencies with exchange differences.
- **Get paid by UPI:** set your UPI ID once and every rupee invoice carries a QR code for what's still owed (on screen, in the PDF, in emails and reminders). Customers scan it with any UPI app; no gateway, no fees.
- **Share on WhatsApp:** send an invoice link the customer opens without an account, to see what's owed, download the PDF or pay by UPI, and see when they opened it.
- **Customer account links:** give each customer one link to everything they owe, with a single UPI QR code for the total.
- **India GST:** CGST + SGST within a state, IGST between states, GST slabs managed by the platform, GSTR-1 and GSTR-3B, HSN/SAC on invoices, and **GSTR-2B reconciliation**: upload the portal's JSON to see which bills your suppliers haven't filed (input credit at risk) before you claim it.
- **Sales:** quotes that become invoices, invoices and credit notes, receipts, recurring invoices, payment reminders (by hand or automatic), credit limits, statements of account.
- **Purchases:** bills, debit notes for purchase returns, recurring bills, vendor payments with TDS kept back (194C, 194J, 194I…) and a TDS report for Form 26Q, approvals for spending above a limit.
- **Banking:** statement import, suggested matches and accounts learned from earlier lines, reconciliation.
- **Stock and assets:** inventory at weighted average cost with reorder levels, fixed assets with depreciation.
- **Cash forecast:** 13 weeks ahead, expecting each customer to pay as late as they usually do, with a warning before cash runs short.
- **Reports:** trial balance, profit and loss (by cost centre, against budget), balance sheet, cash flow, aging, sales and purchases by customer, vendor or item, scheduled reports and a weekly summary email.
- **Documents:** invoices, quotes, receipts and statements as PDFs to download or email, with your terms and bank details; attachments on any document.
- **Data in and out:** Tally Prime XML (ledgers and vouchers) for your CA, spreadsheet imports, CSV and Excel exports that import back, whole-organisation backups, API keys and signed webhooks ([docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)).

## Repository layout

```
apps/web         React 19 · TypeScript · Vite · Tailwind CSS · Framer Motion · i18next
apps/api         NestJS · Prisma · PostgreSQL · JWT · role-based access control
packages/shared  Roles, permissions and accounting rules used by both apps
docs/            Feature list, architecture, deployment, integrations and decision records
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
