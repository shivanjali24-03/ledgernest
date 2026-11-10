# Integrations

How other systems work with LedgerNest: **API keys** to call the API, **webhooks** to hear about changes, **email** for scheduled reports, and **backups** to move an organisation's books. Owners and Admins set up keys and webhooks under **Organisation → Integrations**.

## API keys

A key acts **for the person who made it**, in **one organisation**, within the **scopes** chosen when it was made. It can never do more than its maker can do now: if they're demoted, the key loses what they lost. If they can no longer sign in, it stops working.

- **Shown once.** The key (`lnk_` followed by 40 characters) appears only when it's made. LedgerNest keeps a SHA-256 hash of it, never the key itself.
- **Scopes.** Reading and everyday writes only: accounts, journals (view, create), contacts, invoices, bills, payments, banking (view) and reports (view). People, roles, settings, keys and webhooks are never available to a key.
- **Expiry and revoking.** A key can stop after 30, 90 or 365 days, or run until revoked. Revoking takes effect on the next request.
- **Audit.** Changes made with a key are recorded against its maker and name the key (for example `API key lnk_3f9a1c… · CRM sync`).

Send it as a bearer token. `X-Organization-Id` is optional; if you send it, it must be the key's own organisation:

```sh
curl https://<api>/api/v1/invoices?status=issued \
  -H "Authorization: Bearer lnk_…"
```

The full API is described at `/docs` on the API server (OpenAPI).

## Webhooks

LedgerNest sends a JSON `POST` to your address when something happens:

| Event | When |
|---|---|
| `invoice.issued` | An invoice is issued (numbered and posted) |
| `invoice.voided` | An issued invoice is voided |
| `credit_note.issued` | A credit note is issued against an invoice |
| `credit_note.voided` | A credit note is voided |
| `payment.received` | A receipt from a customer is recorded |
| `payment.made` | A payment to a vendor is recorded |
| `payment.voided` | A receipt or payment is voided |
| `bill.recorded` | A bill is recorded |
| `bill.voided` | A recorded bill is voided |
| `quote.sent` | A quote is marked sent, or emailed while a draft |
| `quote.accepted` | A quote is marked accepted |
| `quote.declined` | A quote is marked declined |
| `quote.invoiced` | A quote becomes a draft invoice (`data.invoiceId` is the invoice) |

The body is the event with the document as the API returns it:

```json
{
  "id": "6f0d…",
  "event": "invoice.issued",
  "createdAt": "2026-11-10T04:12:09.512Z",
  "organizationId": "1c2e…",
  "data": { "id": "…", "number": "INV/2026-27/0042", "total": 11800000, "…": "…" }
}
```

Amounts are in the currency's smallest unit (paise, cents). A test event from **Send a test event** has `"event": "ping"`.

### Headers

| Header | Value |
|---|---|
| `X-LedgerNest-Event` | The event, e.g. `invoice.issued` |
| `X-LedgerNest-Delivery` | The delivery id (also `id` in the body). Use it to ignore a delivery you've already handled |
| `X-LedgerNest-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body" with the endpoint's secret>` |

### Checking the signature

Compute the HMAC over the **raw** body, before parsing it, compare in constant time, and reject old timestamps:

```js
// Node.js (Express): app.post('/ledgernest', express.raw({ type: 'application/json' }), handler)
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody, header, secret, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return parts.v1?.length === expected.length && timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
}
```

```python
# Python
import hashlib, hmac, time

def verify(raw_body: bytes, header: str, secret: str, tolerance: int = 300) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    t = int(parts.get("t", "0"))
    if not t or abs(time.time() - t) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(parts.get("v1", ""), expected)
```

The secret (`whsec_…`) is shown when the webhook is added, and again whenever you **rotate** it.

### Delivery and retries

- Any `2xx` answer within 10 seconds counts as delivered. Redirects aren't followed.
- Otherwise it's retried after **1, 5, 30, 120 and 720 minutes**, then marked failed. The **delivery log** shows every attempt with its HTTP status or error, and any delivery can be tried again by hand.
- Deliveries can arrive more than once, and out of order: use the delivery id, and the document's own state in `data`.
- In production, webhooks must use `https://` and can't point at the server itself or a private network.
- The API server sends due retries every `WEBHOOK_DISPATCH_SECONDS` (60).
- Finished deliveries stay in the log for `WEBHOOK_LOG_DAYS` (30).

## Email for scheduled reports

Scheduled reports (**Reports → Scheduled**) are always kept in the app, to download. To also email them, give the API an SMTP server. Any provider works, including free tiers:

| Variable | Example |
|---|---|
| `SMTP_URL` | `smtps://user:password@smtp.example.com:465` |
| `MAIL_FROM` | `LedgerNest <reports@example.com>` |
| `SCHEDULED_REPORTS_MINUTES` | `15` (how often due reports are made; 0 turns it off) |
| `INVOICE_REMINDERS_MINUTES` | `60` (how often automatic payment reminders go out; 0 turns it off) |
| `WEEKLY_SUMMARY_MINUTES` | `60` (how often to check for Monday weekly summaries; 0 turns it off) |

Reports come as Excel, CSV or PDF. PDFs use the standard PDF fonts, which cover Western European text: the rupee sign is written "Rs", and names in Devanagari (Hindi, Marathi) show as "?", so choose Excel or CSV for those.

The same server also sends **invoices**, **quotes** and **payment receipts** as PDFs (their **Email** actions), **payment reminders**, by hand (an invoice's **Send reminder**) or automatically for overdue invoices (**Settings → Payment reminders**: days after the due date, how often, at most how many), and **statements of account** (**Reports → Statements → Email**): a PDF to the customer or vendor, recorded in the audit trail. Without SMTP, download the PDF and send it yourself.

With **Settings → Email → Weekly summary** on, Owners and Admins get the dashboard's figures and what needs attention every Monday morning (the organisation's time zone).

Reports only go to members who can see reports, checked at each run. Each schedule keeps its latest `REPORT_RUNS_KEPT` (24) runs.

## Backups

Owners can download an organisation's books from **Settings → Backups** as one JSON file (`format: "ledgernest-backup"`). It holds every table that belongs to the organisation: bytes (attachments, the logo) as base64, and big numbers and decimals as text.

**Left behind**: members and invitations, API keys, webhooks, approval requests, the audit trail, and scheduled report files.

**Restoring** makes a **new organisation** owned by the person restoring; the organisation it came from isn't touched.

- **Checked first.** The file is checked before anything is written: every table and column must be one this server knows, every reference must lead to a row in the file, and posted entries must balance.
- **One transaction.** Then it's written in one go.
- **New ids.** Every id is renewed.
- **Posted again.** Entries are posted again and closed months closed again, so the books' rules hold.

Restores take files up to 50 MB.
