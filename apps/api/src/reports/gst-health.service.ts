import { Injectable } from '@nestjs/common';
import { isGstin } from '@ledgernest/shared';
import { PrismaService } from '../prisma/prisma.service.js';

type Address = Record<string, string | null> | null;
const PIN = /^[1-9]\d{5}$/;
const HSN = /^\d{4,8}$/;
const SAMPLE = 8;

export type GstHealthKind =
  | 'org_gstin'
  | 'org_address'
  | 'items_hsn'
  | 'customers_state'
  | 'customers_einvoice'
  | 'vendors_gstin';

/**
 * What would go wrong when filing GST, found before it does: the organisation's own GSTIN and address, items
 * without an HSN or SAC code (GSTR-1's HSN summary), customers without a state (the place of supply decides CGST +
 * SGST or IGST), registered customers missing what e-invoices need, and vendors charging GST without a GSTIN on
 * file (their input credit can't be matched in GSTR-2B). Each with a few examples to open and fix.
 */
@Injectable()
export class GstHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        country: true,
        taxId: true,
        addressLine1: true,
        city: true,
        postalCode: true,
      },
    });
    if (org.country !== 'IN') return { issues: [], checked: false };
    const [items, contacts, gstBills] = await Promise.all([
      this.prisma.item.findMany({
        where: { organizationId, archivedAt: null },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, hsnSac: true },
      }),
      this.prisma.contact.findMany({
        where: { organizationId, archivedAt: null },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          isCustomer: true,
          isVendor: true,
          taxId: true,
          stateCode: true,
          billingAddress: true,
        },
      }),
      // Vendors whose recorded bills carry GST
      this.prisma.bill.findMany({
        where: { organizationId, status: 'open', taxTotal: { gt: 0 } },
        distinct: ['contactId'],
        select: { contactId: true },
      }),
    ]);
    const charged = new Set(gstBills.map((b) => b.contactId));
    const issue = (
      kind: GstHealthKind,
      rows: { id: string; name: string }[],
    ) =>
      rows.length
        ? [{ kind, count: rows.length, sample: rows.slice(0, SAMPLE) }]
        : [];
    // Customers abroad are exports: no Indian state or e-invoice details to check
    const customers = contacts.filter((c) => {
      const country = (c.billingAddress as Address)?.country;
      return c.isCustomer && (!country || country === 'IN');
    });
    const issues = [
      ...(!org.taxId || !isGstin(org.taxId)
        ? [{ kind: 'org_gstin' as const, count: 1, sample: [] }]
        : []),
      ...(!org.addressLine1 || !org.city || !PIN.test(org.postalCode ?? '')
        ? [{ kind: 'org_address' as const, count: 1, sample: [] }]
        : []),
      ...issue(
        'items_hsn',
        items.filter((i) => !HSN.test((i.hsnSac ?? '').replace(/\s/g, ''))),
      ),
      ...issue(
        'customers_state',
        customers.filter((c) => !c.stateCode),
      ),
      ...issue(
        'customers_einvoice',
        customers.filter((c) => {
          const a = c.billingAddress as Address;
          return (
            !!c.taxId &&
            (!a?.line1 ||
              !(a.city ?? a.region) ||
              !PIN.test(a.postalCode ?? ''))
          );
        }),
      ),
      ...issue(
        'vendors_gstin',
        contacts.filter(
          (c) =>
            c.isVendor && charged.has(c.id) && (!c.taxId || !isGstin(c.taxId)),
        ),
      ),
    ];
    return { issues, checked: true };
  }
}
