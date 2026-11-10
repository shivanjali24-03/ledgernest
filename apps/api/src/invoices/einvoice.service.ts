import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  buildEinvoice,
  buildEwayBill,
  einvoiceProblems,
  ewayBillFile,
  ewayProblems,
  invoiceNumber,
  splitTax,
  zeroHeads,
  type EinvoiceInput,
  type EwayTransport,
  type GstHeads,
} from '@ledgernest/shared';
import { PrismaService } from '../prisma/prisma.service.js';

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const head = (kind: string): keyof GstHeads | null =>
  kind === 'igst'
    ? 'igst'
    : kind === 'cgst'
      ? 'cgst'
      : kind === 'sgst' || kind === 'utgst'
        ? 'sgst'
        : kind === 'cess'
          ? 'cess'
          : null;

const invoiceSelect = {
  id: true,
  number: true,
  status: true,
  issueDate: true,
  currency: true,
  placeOfSupply: true,
  fiscalYear: { select: { name: true } },
  contact: {
    select: { name: true, legalName: true, taxId: true, billingAddress: true },
  },
  lines: {
    orderBy: { lineNo: 'asc' as const },
    select: {
      description: true,
      quantity: true,
      unitPrice: true,
      amount: true,
      item: { select: { hsnSac: true, unit: true } },
      taxGroup: {
        select: {
          rates: {
            orderBy: { position: 'asc' as const },
            select: {
              rate: { select: { id: true, kind: true, ratePpm: true } },
            },
          },
        },
      },
    },
  },
} as const;

/**
 * Issued invoices as GST e-invoice JSON (NIC schema 1.1) for the Invoice Registration Portal: one at a time, or every
 * B2B invoice in some dates for the portal's bulk upload. What the portal would refuse is reported instead, so it
 * can be fixed first.
 */
@Injectable()
export class EinvoiceService {
  constructor(private readonly prisma: PrismaService) {}

  private async seller(organizationId: string) {
    const o = await this.prisma.organization.findUniqueOrThrow({
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
        phone: true,
        email: true,
      },
    });
    return {
      gstin: o.taxId?.toUpperCase() ?? null,
      legalName: o.legalName ?? o.name,
      tradeName: o.legalName && o.legalName !== o.name ? o.name : null,
      address1: o.addressLine1,
      address2: o.addressLine2,
      city: o.city ?? o.region,
      pin: o.postalCode,
      phone: o.phone,
      email: o.email,
    };
  }

  private input(
    i: {
      number: number | null;
      issueDate: Date;
      currency: string | null;
      placeOfSupply: string | null;
      fiscalYear: { name: string } | null;
      contact: {
        name: string;
        legalName: string | null;
        taxId: string | null;
        billingAddress: unknown;
      };
      lines: {
        description: string;
        quantity: { toFixed(n: number): string };
        unitPrice: bigint;
        amount: bigint;
        item: { hsnSac: string | null; unit: string | null } | null;
        taxGroup: {
          rates: { rate: { id: string; kind: string; ratePpm: number } }[];
        } | null;
      }[];
    },
    seller: EinvoiceInput['seller'],
  ): EinvoiceInput {
    const a = (i.contact.billingAddress ?? {}) as Record<string, string | null>;
    return {
      kind: 'invoice',
      number:
        i.number && i.fiscalYear
          ? invoiceNumber(i.fiscalYear.name, i.number)
          : '',
      date: iso(i.issueDate),
      currency: i.currency ?? 'INR',
      placeOfSupply: i.placeOfSupply,
      seller,
      buyer: {
        gstin: i.contact.taxId?.toUpperCase() ?? null,
        legalName: i.contact.legalName ?? i.contact.name,
        address1: a.line1 ?? null,
        address2: a.line2 ?? null,
        city: a.city ?? a.region ?? null,
        pin: a.postalCode ?? null,
      },
      lines: i.lines.map((l) => {
        const rates = l.taxGroup?.rates ?? [];
        const heads = zeroHeads();
        splitTax(
          Number(l.amount),
          false,
          rates.map((r) => ({ rateId: r.rate.id, ratePpm: r.rate.ratePpm })),
        ).taxes.forEach((t, k) => {
          const h = head(rates[k]!.rate.kind);
          if (h) heads[h] += t.amount;
        });
        return {
          description: l.description,
          hsn: l.item?.hsnSac?.replace(/\s/g, '') || null,
          quantity: l.quantity.toFixed(3).replace(/\.?0+$/, ''),
          unit: l.item?.unit ?? null,
          unitPrice: Number(l.unitPrice),
          amount: Number(l.amount),
          heads,
          gstRate:
            rates
              .filter((r) =>
                ['igst', 'cgst', 'sgst', 'utgst'].includes(r.rate.kind),
              )
              .reduce((s, r) => s + r.rate.ratePpm, 0) / 10_000,
        };
      }),
    };
  }

  /** One issued invoice's e-invoice JSON, or what has to be fixed first */
  async one(organizationId: string, id: string) {
    const i = await this.prisma.invoice.findFirst({
      where: { id, organizationId },
      select: invoiceSelect,
    });
    if (!i)
      throw new NotFoundException({
        message: 'Invoice not found.',
        details: { reason: 'not_found' },
      });
    if (i.status !== 'issued')
      throw new ConflictException({
        message: 'Only issued invoices have an e-invoice.',
        details: { reason: 'not_issued' },
      });
    const input = this.input(i, await this.seller(organizationId));
    const problems = einvoiceProblems(input);
    if (problems.length)
      throw new ConflictException({
        message:
          'Some details the e-invoice portal needs are missing. Fix them and download again.',
        details: { reason: 'einvoice_incomplete', problems },
      });
    return {
      json: buildEinvoice(input),
      fileName: `e-invoice-${input.number.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`,
    };
  }

  /** One issued invoice's goods as an e-way bill for the portal's bulk upload, or what has to be fixed first */
  async ewayBill(organizationId: string, id: string, transport: EwayTransport) {
    const i = await this.prisma.invoice.findFirst({
      where: { id, organizationId },
      select: invoiceSelect,
    });
    if (!i)
      throw new NotFoundException({
        message: 'Invoice not found.',
        details: { reason: 'not_found' },
      });
    if (i.status !== 'issued')
      throw new ConflictException({
        message: 'Only issued invoices have an e-way bill.',
        details: { reason: 'not_issued' },
      });
    const input = this.input(i, await this.seller(organizationId));
    const problems = ewayProblems(input, transport);
    if (problems.length)
      throw new ConflictException({
        message:
          'Some details the e-way bill portal needs are missing. Fix them and download again.',
        details: { reason: 'eway_incomplete', problems },
      });
    return {
      json: ewayBillFile([buildEwayBill(input, transport)]),
      fileName: `e-way-bill-${input.number.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`,
    };
  }

  /** Every issued invoice to a registered buyer in the dates, for the portal's bulk upload, and those that need fixing */
  async range(organizationId: string, from: string, to: string) {
    const [rows, seller] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          organizationId,
          status: 'issued',
          issueDate: { gte: asDate(from), lte: asDate(to) },
          contact: { taxId: { not: null } },
        },
        orderBy: [{ issueDate: 'asc' }, { number: 'asc' }],
        select: invoiceSelect,
      }),
      this.seller(organizationId),
    ]);
    const invoices: ReturnType<typeof buildEinvoice>[] = [];
    const skipped: {
      id: string;
      number: string;
      problems: ReturnType<typeof einvoiceProblems>;
    }[] = [];
    for (const i of rows) {
      const input = this.input(i, seller);
      const problems = einvoiceProblems(input);
      if (problems.length)
        skipped.push({ id: i.id, number: input.number, problems });
      else invoices.push(buildEinvoice(input));
    }
    return { from, to, invoices, skipped };
  }
}
