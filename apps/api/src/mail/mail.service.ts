import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Sending email, when it's set up: SMTP_URL (e.g. smtps://user:pass@smtp.example.com) and MAIL_FROM. Without
 * them nothing is sent and callers keep what they made in the app. SMTP_URL=json captures messages
 * instead of sending them (for trying it out and for tests).
 */
/** The From line: the server's address, under the organisation's name when it sends for one */
export function senderFor(mailFrom: string, name?: string | null): string {
  if (!name) return mailFrom;
  const address = /<([^>]+)>/.exec(mailFrom)?.[1] ?? mailFrom.trim();
  // Quotes and angle brackets would break the header: keep the name plain
  const clean = name
    .replace(/["<>\\\r\n]/g, '')
    .trim()
    .slice(0, 80);
  return clean ? `"${clean} via LedgerNest" <${address}>` : mailFrom;
}

@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  private transport: Transporter | null = null;
  /** Messages captured with SMTP_URL=json, newest last */
  readonly captured: {
    to: string[];
    subject: string;
    attachments: string[];
  }[] = [];
  /** Their bodies, in the same order */
  readonly capturedText: string[] = [];
  /** And where replies go */
  readonly capturedReplyTo: (string | null)[] = [];

  get configured() {
    return !!process.env.SMTP_URL;
  }

  private get transporter() {
    if (!this.transport && process.env.SMTP_URL)
      this.transport =
        process.env.SMTP_URL === 'json'
          ? nodemailer.createTransport({ jsonTransport: true })
          : nodemailer.createTransport(process.env.SMTP_URL);
    return this.transport;
  }

  /** Sends one message; false (and logged) if it couldn't be */
  async send(m: {
    to: string[];
    subject: string;
    text: string;
    attachments?: { filename: string; content: Buffer; contentType: string }[];
    /** Where replies go: the organisation's own address, for documents sent on its behalf */
    replyTo?: string | null;
    /** Whose name it goes out under, "<name> via LedgerNest", from the server's own address */
    fromName?: string | null;
  }) {
    const t = this.transporter;
    if (!t || !m.to.length) return false;
    try {
      await t.sendMail({
        from: senderFor(
          process.env.MAIL_FROM ?? 'LedgerNest <no-reply@ledgernest.local>',
          m.fromName,
        ),
        to: m.to,
        subject: m.subject,
        text: m.text,
        attachments: m.attachments,
        ...(m.replyTo ? { replyTo: m.replyTo } : {}),
      });
      if (process.env.SMTP_URL === 'json')
        this.captured.push({
          to: m.to,
          subject: m.subject,
          attachments: (m.attachments ?? []).map((a) => a.filename),
        });
      if (process.env.SMTP_URL === 'json') {
        this.capturedText.push(m.text);
        this.capturedReplyTo.push(m.replyTo ?? null);
      }
      return true;
    } catch (e) {
      this.log.error(
        `Couldn’t send “${m.subject}”: ${e instanceof Error ? e.message : String(e)}`,
      );
      return false;
    }
  }
}
