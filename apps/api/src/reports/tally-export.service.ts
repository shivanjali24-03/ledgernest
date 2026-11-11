import { Injectable } from '@nestjs/common';
import {
  billNumber,
  creditNoteNumber,
  vendorCreditNumber,
  invoiceNumber,
  journalNumber,
  paymentNumber,
  tallyGroup,
  tallyMastersXml,
  tallyVoucherType,
  tallyVouchersXml,
  uniqueLedgerNames,
  type TallyVoucher,
} from '@ledgernest/shared';
import { PrismaService } from '../prisma/prisma.service.js';

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const doc = {
  select: {
    number: true,
    contactId: true,
    fiscalYear: { select: { name: true } },
  },
} as const;
/** Invoices, credit notes and debit notes also carry their number as written */
const numbered = { select: { ...doc.select, fullNumber: true } } as const;

/**
 * The books for Tally Prime: ledgers (accounts under Tally's groups, customers and vendors as Sundry Debtors and
 * Creditors), and each posted entry in the dates as a voucher. Lines on receivable and payable accounts go to the
 * customer's or vendor's own ledger when the entry came from their invoice, bill, receipt or credit note, as a Tally
 * user keeps them.
 */
@Injectable()
export class TallyExportService {
  constructor(private readonly prisma: PrismaService) {}

  private async ledgers(organizationId: string) {
    const [org, accounts, contacts, rates] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { name: true, legalName: true },
      }),
      this.prisma.account.findMany({
        where: { organizationId },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, name: true, type: true, subtype: true },
      }),
      this.prisma.contact.findMany({
        where: { organizationId },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, taxId: true, isCustomer: true },
      }),
      this.prisma.taxRate.findMany({
        where: { organizationId },
        select: { outputAccountId: true, inputAccountId: true },
      }),
    ]);
    const taxAccounts = new Set(
      rates
        .flatMap((r) => [r.outputAccountId, r.inputAccountId])
        .filter(Boolean),
    );
    const names = uniqueLedgerNames([
      ...accounts.map((a) => ({ key: a.id, name: a.name, suffix: a.code })),
      ...contacts.map((c) => ({
        key: c.id,
        name: c.name,
        suffix: c.isCustomer ? 'customer' : 'vendor',
      })),
    ]);
    return { org, accounts, contacts, taxAccounts, names };
  }

  async masters(organizationId: string) {
    const { org, accounts, contacts, taxAccounts, names } =
      await this.ledgers(organizationId);
    return tallyMastersXml(org.legalName ?? org.name, [
      ...accounts.map((a) => ({
        name: names.get(a.id)!,
        parent: tallyGroup(a.type, a.subtype, {
          taxAccount: taxAccounts.has(a.id),
        }),
      })),
      ...contacts.map((c) => ({
        name: names.get(c.id)!,
        parent: c.isCustomer ? 'Sundry Debtors' : 'Sundry Creditors',
        gstin: c.taxId,
      })),
    ]);
  }

  async vouchers(organizationId: string, from: string, to: string) {
    const [{ org, accounts, names }, entries] = await Promise.all([
      this.ledgers(organizationId),
      this.prisma.journalEntry.findMany({
        where: {
          organizationId,
          status: 'posted',
          date: { gte: asDate(from), lte: asDate(to) },
        },
        orderBy: [{ date: 'asc' }, { number: 'asc' }],
        select: {
          number: true,
          date: true,
          memo: true,
          fiscalYear: { select: { name: true } },
          lines: {
            orderBy: { lineNo: 'asc' },
            select: { accountId: true, debit: true, credit: true },
          },
          invoice: numbered,
          voidedInvoice: numbered,
          bill: doc,
          voidedBill: doc,
          creditNote: numbered,
          voidedCreditNote: numbered,
          payment: { select: { ...doc.select, kind: true } },
          voidedPayment: { select: { ...doc.select, kind: true } },
          vendorCredit: numbered,
          voidedVendorCredit: numbered,
          // Refunds of credit given: the customer's or vendor's own ledger too
          creditRefund: { select: { creditNote: numbered } },
          vendorRefund: { select: { vendorCredit: numbered } },
        },
      }),
    ]);
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const vouchers: TallyVoucher[] = entries.map((e) => {
      // What the entry came from, and its number as the document has it
      const src: {
        kind: 'invoice' | 'bill' | 'credit_note' | 'debit_note' | 'payment';
        number: string;
        contactId: string;
        voided: boolean;
      } | null = e.invoice
        ? {
            kind: 'invoice',
            number:
              e.invoice.fullNumber ??
              invoiceNumber(e.invoice.fiscalYear!.name, e.invoice.number!),
            contactId: e.invoice.contactId,
            voided: false,
          }
        : e.voidedInvoice
          ? {
              kind: 'invoice',
              number:
                e.voidedInvoice.fullNumber ??
                invoiceNumber(
                  e.voidedInvoice.fiscalYear!.name,
                  e.voidedInvoice.number!,
                ),
              contactId: e.voidedInvoice.contactId,
              voided: true,
            }
          : e.bill
            ? {
                kind: 'bill',
                number: billNumber(e.bill.fiscalYear!.name, e.bill.number!),
                contactId: e.bill.contactId,
                voided: false,
              }
            : e.voidedBill
              ? {
                  kind: 'bill',
                  number: billNumber(
                    e.voidedBill.fiscalYear!.name,
                    e.voidedBill.number!,
                  ),
                  contactId: e.voidedBill.contactId,
                  voided: true,
                }
              : e.creditNote
                ? {
                    kind: 'credit_note',
                    number:
                      e.creditNote.fullNumber ??
                      creditNoteNumber(
                        e.creditNote.fiscalYear.name,
                        e.creditNote.number,
                      ),
                    contactId: e.creditNote.contactId,
                    voided: false,
                  }
                : e.voidedCreditNote
                  ? {
                      kind: 'credit_note',
                      number:
                        e.voidedCreditNote.fullNumber ??
                        creditNoteNumber(
                          e.voidedCreditNote.fiscalYear.name,
                          e.voidedCreditNote.number,
                        ),
                      contactId: e.voidedCreditNote.contactId,
                      voided: true,
                    }
                  : e.payment
                    ? {
                        kind: 'payment',
                        number: paymentNumber(
                          e.payment.kind as 'receipt',
                          e.payment.fiscalYear.name,
                          e.payment.number,
                        ),
                        contactId: e.payment.contactId,
                        voided: false,
                      }
                    : e.voidedPayment
                      ? {
                          kind: 'payment',
                          number: paymentNumber(
                            e.voidedPayment.kind as 'receipt',
                            e.voidedPayment.fiscalYear.name,
                            e.voidedPayment.number,
                          ),
                          contactId: e.voidedPayment.contactId,
                          voided: true,
                        }
                      : (e.vendorCredit ?? e.voidedVendorCredit)
                        ? {
                            kind: 'debit_note',
                            number:
                              (e.vendorCredit ?? e.voidedVendorCredit)!
                                .fullNumber ??
                              vendorCreditNumber(
                                (e.vendorCredit ?? e.voidedVendorCredit)!
                                  .fiscalYear.name,
                                (e.vendorCredit ?? e.voidedVendorCredit)!
                                  .number,
                              ),
                            contactId: (e.vendorCredit ?? e.voidedVendorCredit)!
                              .contactId,
                            voided: !e.vendorCredit,
                          }
                        : e.creditRefund?.creditNote
                          ? {
                              kind: 'payment',
                              number: `${e.creditRefund.creditNote.fullNumber ?? creditNoteNumber(e.creditRefund.creditNote.fiscalYear.name, e.creditRefund.creditNote.number)} refund`,
                              contactId: e.creditRefund.creditNote.contactId,
                              voided: false,
                            }
                          : e.vendorRefund?.vendorCredit
                            ? {
                                kind: 'payment',
                                number: `${e.vendorRefund.vendorCredit.fullNumber ?? vendorCreditNumber(e.vendorRefund.vendorCredit.fiscalYear.name, e.vendorRefund.vendorCredit.number)} refund`,
                                contactId:
                                  e.vendorRefund.vendorCredit.contactId,
                                voided: false,
                              }
                            : null;
      const lines = e.lines.map((l) => {
        const a = byId.get(l.accountId)!;
        const party =
          src &&
          (a.subtype === 'accounts_receivable' ||
            a.subtype === 'accounts_payable');
        return {
          ledger: party ? names.get(src.contactId)! : names.get(a.id)!,
          bank:
            a.type === 'asset' &&
            (a.subtype === 'bank' || a.subtype === 'cash'),
          debit: Number(l.debit),
          credit: Number(l.credit),
        };
      });
      const own =
        e.number && e.fiscalYear
          ? journalNumber(e.fiscalYear.name, e.number)
          : '';
      return {
        // A void undoes its document: a journal in Tally, numbered after it
        type: src?.voided
          ? 'Journal'
          : tallyVoucherType(lines, src?.kind ?? null),
        date: iso(e.date),
        number: src ? `${src.number}${src.voided ? ' void' : ''}` : own,
        narration:
          [e.memo, own && src ? own : null].filter(Boolean).join(' · ') || null,
        lines,
      };
    });
    return {
      xml: tallyVouchersXml(org.legalName ?? org.name, vouchers),
      count: vouchers.length,
    };
  }
}
