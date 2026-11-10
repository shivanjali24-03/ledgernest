import { ConflictException, Injectable } from '@nestjs/common';
import {
  INDIAN_STATES,
  currencyDigits,
  pdfTableBytes,
  rupeesInWords,
  splitTax,
  toBase,
} from '@ledgernest/shared';
import { organizationLogo } from '../common/pdf-logo.js';
import { PrismaService } from '../prisma/prisma.service.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The self-invoice for a purchase under reverse charge from a supplier who isn't registered (CGST Act s.31(3)(f),
 * rule 46): raised by us as the recipient, in rupees, each line with its HSN/SAC, taxable value and the GST we pay.
 * Services bought from abroad are converted at the bill's rate.
 */
@Injectable()
export class SelfInvoicePdfService {
  constructor(private readonly prisma: PrismaService) {}

  async download(organizationId: string, id: string) {
    const [bill, org, logo] = await Promise.all([
      this.prisma.bill.findFirst({
        where: { organizationId, id },
        select: {
          status: true,
          selfInvoiceNumber: true,
          billDate: true,
          vendorReference: true,
          vendorBillDate: true,
          currency: true,
          rate: true,
          placeOfSupply: true,
          contact: {
            select: { name: true, legalName: true, billingAddress: true },
          },
          lines: {
            orderBy: { lineNo: 'asc' },
            select: {
              description: true,
              quantity: true,
              amount: true,
              item: { select: { hsnSac: true } },
              rcmTaxGroup: {
                select: {
                  name: true,
                  rates: {
                    orderBy: { position: 'asc' },
                    select: {
                      rate: { select: { id: true, name: true, ratePpm: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
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
        },
      }),
      organizationLogo(this.prisma, organizationId),
    ]);
    if (!bill?.selfInvoiceNumber)
      throw new ConflictException({
        message:
          'Only a bill recorded under reverse charge from an unregistered supplier has a self-invoice.',
        details: { reason: 'no_self_invoice' },
      });
    // In rupees: a foreign bill at its rate
    const inr = (minor: bigint) =>
      bill.currency && bill.rate
        ? toBase(
            Number(minor),
            bill.rate.toString(),
            currencyDigits(bill.currency),
            2,
          )
        : Number(minor);
    const fmt = (paise: number) => (paise / 100).toFixed(2);
    const byRate = new Map<string, number>();
    let taxable = 0;
    const rows = bill.lines.map((l) => {
      const value = inr(l.amount);
      taxable += value;
      const rates = l.rcmTaxGroup?.rates ?? [];
      const taxes = splitTax(
        value,
        false,
        rates.map((r) => ({ rateId: r.rate.id, ratePpm: r.rate.ratePpm })),
      ).taxes;
      taxes.forEach((t, k) => {
        const name = rates[k]!.rate.name;
        byRate.set(name, (byRate.get(name) ?? 0) + t.amount);
      });
      return [
        l.description,
        l.item?.hsnSac ?? '',
        l.quantity.toFixed(3).replace(/\.?0+$/, ''),
        fmt(value),
        l.rcmTaxGroup?.name ?? '',
        fmt(taxes.reduce((s, t) => s + t.amount, 0)),
      ];
    });
    const tax = [...byRate.values()].reduce((s, x) => s + x, 0);
    const total = (label: string, paise: number) => [
      '',
      '',
      '',
      label,
      '',
      fmt(paise),
    ];
    const address = (a: Record<string, string | null | undefined>) =>
      [a.line1, a.line2, a.city, a.region, a.postalCode]
        .filter(Boolean)
        .join(', ');
    const us = org.legalName ?? org.name;
    const state = INDIAN_STATES.find((s) => s.code === bill.placeOfSupply);
    const number = bill.selfInvoiceNumber;
    const pdf = Buffer.from(
      pdfTableBytes({
        logo,
        title: `Self invoice ${number}${bill.status === 'void' ? ' (void)' : ''}`,
        subtitle: `${us}${org.taxId ? ` · GSTIN ${org.taxId}` : ''} (recipient)`,
        info: [
          address({
            line1: org.addressLine1,
            line2: org.addressLine2,
            city: org.city,
            region: org.region,
            postalCode: org.postalCode,
          }),
          `Supplier (unregistered): ${bill.contact.legalName ?? bill.contact.name}`,
          address(
            (bill.contact.billingAddress ?? {}) as Record<
              string,
              string | null
            >,
          ),
          `Date ${iso(bill.billDate)}${bill.vendorReference ? ` · Supplier’s bill ${bill.vendorReference}${bill.vendorBillDate ? ` dated ${iso(bill.vendorBillDate)}` : ''}` : ''}${state ? ` · Place of supply ${state.name} (${state.code})` : ''}`,
          ...(bill.currency && bill.rate
            ? [`Converted from ${bill.currency} at ${bill.rate.toString()}`]
            : []),
        ].filter(Boolean),
        rows: [
          [
            'Description',
            'HSN/SAC',
            'Qty',
            'Taxable value (INR)',
            'GST',
            'Tax',
          ],
          ...rows,
          total('Taxable value', taxable),
          ...[...byRate].map(([name, amount]) => total(name, amount)),
          total('GST payable by the recipient', tax),
        ],
        after: [
          'Whether tax is payable on reverse charge: Yes',
          `GST payable in words: ${rupeesInWords(tax)}`,
          ...(org.taxId
            ? ['', `For ${us}`, '', '', 'Authorised signatory']
            : []),
        ],
        footer: `${us} · ${number}`,
      }),
    );
    return {
      data: pdf,
      fileName: `self-invoice-${number.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
    };
  }
}
