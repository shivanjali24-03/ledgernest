import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  buildEinvoice,
  currencyDigits,
  toBase,
  buildEwayBill,
  einvoiceProblems,
  ewayBillFile,
  ewayProblems,
  invoiceNumber,
  splitTax,
  zeroHeads,
  type EinvoiceInput,
  type EinvoiceIrnInput,
  type EwayTransport,
  type GstHeads,
  findIndianState,
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

const groupRates = {
  rates: {
    orderBy: { position: 'asc' as const },
    select: {
      rate: { select: { id: true, kind: true, ratePpm: true } },
    },
  },
} as const;

const invoiceSelect = {
  id: true,
  number: true,
  status: true,
  issueDate: true,
  currency: true,
  rate: true,
  placeOfSupply: true,
  shipTo: true,
  roundOff: true,
  pricesIncludeTax: true,
  supplyKind: true,
  exportDetails: true,
  reverseCharge: true,
  opening: true,
  gstRegistrationId: true,
  fiscalYear: { select: { name: true } },
  fullNumber: true,
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
      inAltUnit: true,
      item: { select: { hsnSac: true, unit: true, altUnit: true } },
      taxGroup: { select: groupRates },
      rcmTaxGroup: { select: groupRates },
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

  /** The supplier: the organisation, or the other GSTIN of it the invoice is under (its number, name and address) */
  private async seller(organizationId: string, registrationId?: string | null) {
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
    const reg = registrationId
      ? await this.prisma.gstRegistration.findUnique({
          where: { id: registrationId },
          select: { gstin: true, tradeName: true, address: true },
        })
      : null;
    const a = (reg?.address ?? null) as Record<string, string | null> | null;
    return {
      gstin: (reg?.gstin ?? o.taxId)?.toUpperCase() ?? null,
      legalName: o.legalName ?? o.name,
      tradeName:
        reg?.tradeName ??
        (o.legalName && o.legalName !== o.name ? o.name : null),
      address1: a ? a.line1 : o.addressLine1,
      address2: a ? a.line2 : o.addressLine2,
      city: a ? (a.city ?? a.region) : (o.city ?? o.region),
      pin: a ? a.postalCode : o.postalCode,
      phone: o.phone,
      email: o.email,
    };
  }

  private input(
    i: {
      number: number | null;
      issueDate: Date;
      currency: string | null;
      /** A foreign-currency invoice's rate: the portals take rupees */
      rate?: { toString(): string } | null;
      placeOfSupply: string | null;
      shipTo?: unknown;
      roundOff?: bigint;
      pricesIncludeTax?: boolean;
      supplyKind?: string;
      exportDetails?: unknown;
      reverseCharge?: boolean;
      fullNumber: string | null;
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
        inAltUnit: boolean;
        item: {
          hsnSac: string | null;
          unit: string | null;
          altUnit: string | null;
        } | null;
        taxGroup: {
          rates: { rate: { id: string; kind: string; ratePpm: number } }[];
        } | null;
        rcmTaxGroup?: {
          rates: { rate: { id: string; kind: string; ratePpm: number } }[];
        } | null;
      }[];
    },
    seller: EinvoiceInput['seller'],
  ): EinvoiceInput {
    const a = (i.contact.billingAddress ?? {}) as Record<string, string | null>;
    // The portals take every value in rupees: a foreign-currency invoice goes at the rate it was posted at, its
    // currency named in the export details (ForCur)
    const rate = i.currency && i.rate ? i.rate.toString() : null;
    const inr = (minor: number) =>
      rate ? toBase(minor, rate, currencyDigits(i.currency!), 2) : minor;
    return {
      kind: 'invoice',
      number:
        i.number && i.fiscalYear
          ? (i.fullNumber ?? invoiceNumber(i.fiscalYear.name, i.number))
          : '',
      date: iso(i.issueDate),
      currency: rate ? 'INR' : (i.currency ?? 'INR'),
      placeOfSupply: i.placeOfSupply,
      roundOff: inr(Number(i.roundOff ?? 0)),
      supplyKind: i.supplyKind ?? 'regular',
      exportDetails:
        (i.exportDetails as EinvoiceInput['exportDetails']) ?? null,
      foreignCurrency: i.currency,
      reverseCharge: !!i.reverseCharge,
      seller,
      buyer: {
        gstin: i.contact.taxId?.toUpperCase() ?? null,
        legalName: i.contact.legalName ?? i.contact.name,
        address1: a.line1 ?? null,
        address2: a.line2 ?? null,
        city: a.city ?? a.region ?? null,
        pin: a.postalCode ?? null,
      },
      // Goods delivered elsewhere: the ship-to address, with its state for the portals
      shipTo: i.shipTo
        ? (() => {
            const s = i.shipTo as Record<string, string | null>;
            return {
              gstin: null,
              legalName: s.name ?? i.contact.legalName ?? i.contact.name,
              address1: s.line1 ?? null,
              address2: s.line2 ?? null,
              city: s.city ?? s.region ?? null,
              pin: s.postalCode ?? null,
              stateCode: findIndianState(s.region)?.code ?? null,
            };
          })()
        : null,
      lines: i.lines.map((l) => {
        // Under reverse charge the buyer pays the tax, reported to the portal all the same
        const rates = (l.taxGroup ?? l.rcmTaxGroup)?.rates ?? [];
        const heads = zeroHeads();
        const amount = inr(Number(l.amount));
        splitTax(
          amount,
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
          // The unit the line's quantity is in
          unit: (l.inAltUnit ? l.item?.altUnit : null) ?? l.item?.unit ?? null,
          // Prices that include GST go to the portal without it
          unitPrice: inr(
            i.pricesIncludeTax && !i.reverseCharge
              ? Math.round(
                  (Number(l.unitPrice) * 1_000_000) /
                    (1_000_000 + rates.reduce((s, r) => s + r.rate.ratePpm, 0)),
                )
              : Number(l.unitPrice),
          ),
          amount,
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
    if (i.opening)
      throw new ConflictException({
        message:
          'This invoice was owed from before the books started here: it was reported then.',
        details: { reason: 'opening_invoice' },
      });
    const input = this.input(
      i,
      await this.seller(organizationId, i.gstRegistrationId),
    );
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
    if (i.opening)
      throw new ConflictException({
        message:
          'This invoice was owed from before the books started here: its goods moved then.',
        details: { reason: 'opening_invoice' },
      });
    const input = this.input(
      i,
      await this.seller(organizationId, i.gstRegistrationId),
    );
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

  /** Records the IRN the portal gave the invoice, to print it and its signed QR code */
  async setIrn(
    organizationId: string,
    id: string,
    input: EinvoiceIrnInput & { irn: string },
    actorId: string,
  ) {
    const i = await this.prisma.invoice.findFirst({
      where: { id, organizationId },
      select: { status: true },
    });
    if (!i)
      throw new NotFoundException({
        message: 'Invoice not found.',
        details: { reason: 'not_found' },
      });
    if (i.status !== 'issued')
      throw new ConflictException({
        message: 'Only issued invoices are registered on the e-invoice portal.',
        details: { reason: 'not_issued' },
      });
    await this.prisma.invoice.update({
      where: { id },
      data: {
        irn: input.irn,
        irnAckNo: input.ackNo,
        irnAckDate: input.ackDate,
        irnSignedQr: input.signedQrCode,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        action: 'org.invoice.irn',
        actorId,
        organizationId,
        entityType: 'invoice',
        entityId: id,
        after: { irn: input.irn, ackNo: input.ackNo },
      },
    });
  }

  /** Takes the IRN off (it was cancelled on the portal) */
  async clearIrn(organizationId: string, id: string, actorId: string) {
    const r = await this.prisma.invoice.updateMany({
      where: { id, organizationId, irn: { not: null } },
      data: { irn: null, irnAckNo: null, irnAckDate: null, irnSignedQr: null },
    });
    if (r.count)
      await this.prisma.auditLog.create({
        data: {
          action: 'org.invoice.irn_cleared',
          actorId,
          organizationId,
          entityType: 'invoice',
          entityId: id,
        },
      });
  }

  /** Every issued invoice to a registered buyer in the dates, for the portal's bulk upload, and those that need fixing */
  async range(organizationId: string, from: string, to: string) {
    const [rows, seller] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          organizationId,
          status: 'issued',
          opening: false,
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
    // Each under its own GSTIN: the organisation's, or another of it
    const sellers = new Map<string, typeof seller>();
    for (const i of rows) {
      const key = i.gstRegistrationId ?? '';
      if (key && !sellers.has(key))
        sellers.set(key, await this.seller(organizationId, key));
      const input = this.input(i, key ? sellers.get(key)! : seller);
      const problems = einvoiceProblems(input);
      if (problems.length)
        skipped.push({ id: i.id, number: input.number, problems });
      else invoices.push(buildEinvoice(input));
    }
    return { from, to, invoices, skipped };
  }
}
