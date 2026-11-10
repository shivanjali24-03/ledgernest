import { Injectable } from '@nestjs/common';
import {
  currencyDigits,
  pdfTableBytes,
  rupeesInWords,
} from '@ledgernest/shared';
import { organizationLogo } from '../common/pdf-logo.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { VendorCreditsService } from './vendor-credits.service.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * A debit note as the vendor receives it, for goods sent back or a price put right: from us to them (with GSTINs),
 * against which of their bills (by their number) and its date, each line with its HSN/SAC, taxable value and tax.
 */
@Injectable()
export class DebitNotePdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notes: VendorCreditsService,
  ) {}

  async download(organizationId: string, id: string) {
    const dn = await this.notes.get(organizationId, id);
    const [org, vendor, bill, billLines, logo] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: {
          name: true,
          legalName: true,
          taxId: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          region: true,
          postalCode: true,
          baseCurrency: true,
        },
      }),
      this.prisma.contact.findFirstOrThrow({
        where: { organizationId, id: dn.contact.id },
        select: {
          name: true,
          legalName: true,
          taxId: true,
          billingAddress: true,
        },
      }),
      this.prisma.bill.findFirstOrThrow({
        where: { organizationId, id: dn.bill.id },
        select: { billDate: true },
      }),
      this.prisma.billLine.findMany({
        where: {
          organizationId,
          id: {
            in: dn.lines.flatMap((l) => (l.billLineId ? [l.billLineId] : [])),
          },
        },
        select: { id: true, item: { select: { hsnSac: true } } },
      }),
      organizationLogo(this.prisma, organizationId),
    ]);
    const hsn = new Map(billLines.map((l) => [l.id, l.item?.hsnSac ?? '']));
    const currency = org.baseCurrency;
    const digits = currencyDigits(currency);
    const fmt = (minor: number) => (minor / 10 ** digits).toFixed(digits);
    const total = (label: string, minor: number) => [
      '',
      '',
      '',
      label,
      '',
      fmt(minor),
    ];
    const address = (a: Record<string, string | null | undefined>) =>
      [a.line1, a.line2, a.city, a.region, a.postalCode]
        .filter(Boolean)
        .join(', ');
    const buyer = org.legalName ?? org.name;
    const theirBill = dn.bill.vendorReference ?? dn.bill.number ?? '';
    const pdf = Buffer.from(
      pdfTableBytes({
        logo,
        title: `Debit note ${dn.number}${dn.status === 'void' ? ' (void)' : ''}`,
        subtitle: `${buyer}${org.taxId ? ` · GSTIN ${org.taxId}` : ''}`,
        info: [
          address({
            line1: org.addressLine1,
            line2: org.addressLine2,
            city: org.city,
            region: org.region,
            postalCode: org.postalCode,
          }),
          `To: ${vendor.legalName ?? vendor.name}${vendor.taxId ? ` · ${vendor.taxId}` : ''}`,
          address(
            (vendor.billingAddress ?? {}) as Record<string, string | null>,
          ),
          `Date ${dn.date} · Against your bill ${theirBill} dated ${iso(bill.billDate)}${dn.vendorReference ? ` · Your credit note ${dn.vendorReference}` : ''}`,
          ...(dn.reason ? [`Reason: ${dn.reason}`] : []),
        ].filter(Boolean),
        rows: [
          [
            'Description',
            'HSN/SAC',
            'Qty',
            `Price (${currency})`,
            'Taxable value',
            'Tax',
          ],
          ...dn.lines.map((l) => [
            l.description,
            (l.billLineId && hsn.get(l.billLineId)) || '',
            l.quantity,
            fmt(l.unitPrice),
            fmt(l.amount),
            fmt(l.taxAmount),
          ]),
          total('Subtotal', dn.subtotal),
          ...dn.taxBreakdown.map((t) => total(t.name, t.amount)),
          total(`Total (${currency})`, dn.total),
        ],
        after: [
          ...(currency === 'INR'
            ? [`Amount in words: ${rupeesInWords(dn.total)}`]
            : []),
          ...(org.taxId
            ? ['', `For ${buyer}`, '', '', 'Authorised signatory']
            : []),
        ],
        footer: `${buyer} · ${dn.number}`,
      }),
    );
    return {
      data: pdf,
      fileName: `debit-note-${dn.number.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
    };
  }
}
