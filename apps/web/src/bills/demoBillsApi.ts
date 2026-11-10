import { billDraftSchema, billNumber, billState, currencyDigits, dueDateFor, invoiceAmounts, splitTax, todayIn, toBase, type BillStatus, possibleDuplicateBills } from '@ledgernest/shared';
import { demoApprovalCheck } from '../approvals/demoApprovalsApi';
import { ApiError } from '../auth/client';
import { csvBlob, major } from '../lib/listCsv';
import { demoCheckUndo, demoInventoryAccountOf, demoSaveMovements, demoStockReceipts, demoUndoDocument } from '../inventory/demoInventoryApi';
import { demoCostCentreRef } from '../cost-centres/demoCostCentresApi';
import { demoAccountRows, sampleId } from '../accounts/demoAccountsApi';
import { demoContactRows } from '../contacts/demoContactsApi';
import { demoRateOn } from '../currencies/demoCurrenciesApi';
import { demoItemRows } from '../items/demoItemsApi';
import { createDemoJournalsApi } from '../journals/demoJournalsApi';
import { createDemoPeriodsApi } from '../periods/demoPeriodsApi';
import { demoTaxState } from '../taxes/demoTaxesApi';
import { groupForSupply, supplyFor } from '../invoices/gst';
import type { Bill, BillsApi } from './types';

/**
 * Bills in demo mode for the sample company in Pune: the month's rent bill from Sharma Office Supplies, in the
 * same state so CGST + SGST, recorded and waiting to be paid; and a draft for AWS hosting in US dollars.
 */
const KEY = 'ledgernest.demo.bills';
const ORG_STATE = '27';
type StoredLine = {
  itemId: string | null;
  description: string;
  quantity: string;
  unitPrice: number;
  discountPpm: number;
  taxGroupId: string | null;
  accountId: string;
  costCentreId?: string | null;
};
type Stored = {
  id: string;
  number: number | null;
  yearName: string | null;
  status: BillStatus;
  contactId: string;
  billDate: string;
  dueDate: string;
  currency: string | null;
  rate: string | null;
  placeOfSupply: string | null;
  vendorReference: string | null;
  vendorBillDate?: string | null;
  notes: string | null;
  amountPaid: number;
  journalEntryId: string | null;
  journalNumber: string | null;
  voidEntryId: string | null;
  voidNumber: string | null;
  lines: StoredLine[];
  payments?: { id: string; number: string; date: string; amount: number }[];
  debitNotes?: { id: string; number: string; status: 'issued' | 'void'; total: number }[];
  credits?: { id: string; number: string; date: string; amount: number }[];
};
const today = () => todayIn('Asia/Kolkata');
const thisMonth = (day: number) => `${today().slice(0, 8)}${String(Math.min(day, Number(today().slice(8)))).padStart(2, '0')}`;

async function seed(): Promise<Stored[]> {
  const contacts = demoContactRows();
  const sharma = contacts.find((c) => c.name === 'Sharma Office Supplies')!;
  const aws = contacts.find((c) => c.name === 'Amazon Web Services')!;
  const gst18 = demoTaxState().groups.find((g) => g.name === 'GST 18%')?.id ?? null;
  const blank = {
    number: null,
    yearName: null,
    status: 'draft' as const,
    rate: null,
    amountPaid: 0,
    journalEntryId: null,
    journalNumber: null,
    voidEntryId: null,
    voidNumber: null,
  };
  return [
    {
      id: crypto.randomUUID(),
      ...blank,
      contactId: sharma.id,
      billDate: thisMonth(3),
      dueDate: dueDateFor(thisMonth(3), sharma.paymentTermsDays),
      currency: null,
      placeOfSupply: sharma.stateCode,
      vendorReference: 'SOS/887',
      notes: null,
      lines: [
        {
          itemId: null,
          description: 'Office rent',
          quantity: '1',
          unitPrice: 4_500_000,
          discountPpm: 0,
          taxGroupId: gst18,
          accountId: sampleId('5300'),
        },
      ],
    },
    {
      id: crypto.randomUUID(),
      ...blank,
      contactId: aws.id,
      billDate: today(),
      dueDate: today(),
      currency: 'USD',
      placeOfSupply: null,
      vendorReference: 'EUINAWS-8812',
      notes: null,
      lines: [
        {
          itemId: null,
          description: 'Cloud hosting, last month',
          quantity: '1',
          unitPrice: 41_250,
          discountPpm: 0,
          taxGroupId: null,
          accountId: sampleId('5100'),
        },
      ],
    },
  ];
}
let pending: Promise<void> | null = null;
/** Rows as stored; the first use seeds them, recording the rent bill (`seeding` is that recording reading them) */
async function loadRows(seeding = false): Promise<Stored[]> {
  if (pending && !seeding) await pending;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Stored[];
  } catch {
    /* fall through */
  }
  pending ??= seed()
    .then(async (rows) => {
      save(rows);
      await createDemoBillsApi(() => true, true)
        .record(rows[0]!.id)
        .catch(() => undefined);
    })
    .finally(() => (pending = null));
  await pending;
  return loadRows();
}
function save(rows: Stored[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* private mode */
  }
}
/** The bills already in the demo, without seeding them (seeding posts to the books): for contacts' balances */
export function demoStoredBillViews(): Bill[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored[]).map(view) : [];
  } catch {
    return [];
  }
}
/** The demo's bills as the screens see them, for payments */
export async function demoBillViews(): Promise<Bill[]> {
  return (await loadRows()).map(view);
}
/** A payment (or its void) changes what a bill has had paid */
export async function demoAdjustBillPaid(billId: string, delta: number, payment?: { id: string; number: string; date: string; amount: number }) {
  const rows = await loadRows();
  const i = rows.find((r) => r.id === billId);
  if (!i) return;
  i.amountPaid += delta;
  i.payments = payment ? [...(i.payments ?? []), payment] : (i.payments ?? []).filter((p) => p.amount !== -delta || delta > 0);
  save(rows);
}

/** A debit note's credit put on a bill (or taken off it when the note is voided) */
export async function demoAdjustBillCredit(billId: string, credit: { id: string; number: string; date: string; amount: number }, remove = false) {
  const rows = await loadRows();
  const i = rows.find((r) => r.id === billId);
  if (!i) return;
  i.amountPaid += remove ? -credit.amount : credit.amount;
  i.credits = remove ? (i.credits ?? []).filter((c) => !(c.id === credit.id && c.amount === credit.amount)) : [...(i.credits ?? []), credit];
  save(rows);
}
/** Lists a debit note on its bill, or marks it void there */
export async function demoTrackDebitNote(billId: string, note: { id: string; number: string; status: 'issued' | 'void'; total: number }) {
  const rows = await loadRows();
  const i = rows.find((r) => r.id === billId);
  if (!i) return;
  i.debitNotes = [...(i.debitNotes ?? []).filter((n) => n.id !== note.id), note];
  save(rows);
}

export const resetDemoBills = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};

const refuse = (status: 400 | 409, reason: string, extra: object = {}) => new ApiError(status === 400 ? 'validation' : 'conflict', status, undefined, undefined, { reason, ...extra });
const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 150));

/** A group with its rates, from the demo's taxes */
function groupOf(id: string | null) {
  if (!id) return null;
  const tax = demoTaxState();
  const g = tax.groups.find((x) => x.id === id);
  if (!g) return null;
  const rates = g.rateIds.map((rid) => tax.rates.find((r) => r.id === rid)!);
  return {
    id: g.id,
    name: g.name,
    gstSlabId: g.gstSlabId,
    supply: g.supply,
    archived: !!g.archivedAt,
    rates,
  };
}
function allGroups() {
  return demoTaxState().groups.map((g) => groupOf(g.id)!);
}

function view(i: Stored): Bill {
  const contact = demoContactRows().find((c) => c.id === i.contactId)!;
  const accounts = demoAccountRows();
  const items = demoItemRows();
  const groups = i.lines.map((l) => groupOf(l.taxGroupId));
  const a = invoiceAmounts(
    i.lines.map((l, n) => ({
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPpm: l.discountPpm,
      rates: (groups[n]?.rates ?? []).map((r) => ({
        rateId: r.id,
        ratePpm: r.ratePpm,
      })),
    })),
  );
  const breakdown = new Map<string, number>();
  i.lines.forEach((_l, n) => {
    const g = groups[n];
    if (!g) return;
    splitTax(
      a.lines[n]!.net,
      false,
      g.rates.map((r) => ({ rateId: r.id, ratePpm: r.ratePpm })),
    ).taxes.forEach((t, k) => breakdown.set(g.rates[k]!.name, (breakdown.get(g.rates[k]!.name) ?? 0) + t.amount));
  });
  const payable = accounts.find((x) => x.type === 'liability' && (x.currency ?? null) === i.currency && /accounts payable/i.test(x.name));
  const base = {
    id: i.id,
    number: i.number && i.yearName ? billNumber(i.yearName, i.number) : null,
    status: i.status,
    billDate: i.billDate,
    dueDate: i.dueDate,
    currency: i.currency,
    rate: i.rate,
    placeOfSupply: i.placeOfSupply,
    vendorReference: i.vendorReference,
    vendorBillDate: i.vendorBillDate ?? null,
    notes: i.notes,
    contact: {
      id: contact.id,
      name: contact.name,
      legalName: contact.legalName,
      taxId: contact.taxId,
      email: contact.email,
      billingAddress: { ...contact.billingAddress },
      shippingAddress: contact.shippingAddress && {
        ...contact.shippingAddress,
      },
      stateCode: contact.stateCode,
    },
    payableAccount: payable ? { id: payable.id, code: payable.code, name: payable.name } : null,
    subtotal: a.subtotal,
    taxTotal: a.tax,
    total: a.total,
    amountPaid: i.amountPaid,
    balance: a.total - i.amountPaid,
    taxBreakdown: [...breakdown].map(([name, amount]) => ({ name, amount })),
    journalEntry: i.journalEntryId ? { id: i.journalEntryId, number: i.journalNumber } : null,
    payments: i.payments ?? [],
    debitNotes: i.debitNotes ?? [],
    credits: i.credits ?? [],
    voidEntry: i.voidEntryId ? { id: i.voidEntryId, number: i.voidNumber } : null,
    lines: i.lines.map((l, n) => {
      const item = l.itemId ? items.find((x) => x.id === l.itemId) : undefined;
      const acc = accounts.find((x) => x.id === l.accountId);
      const g = groups[n];
      return {
        // A UUID like the API's, stable per line: the bill's with the line's index in its last digits
        id: `${i.id.slice(0, 32)}${n.toString(16).padStart(4, '0')}`,
        lineNo: n + 1,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discountPpm / 10_000,
        amount: a.lines[n]!.net,
        taxAmount: a.lines[n]!.tax,
        costCentre: demoCostCentreRef(l.costCentreId),
        item: item
          ? {
              id: item.id,
              name: item.name,
              hsnSac: item.hsnSac,
              unit: item.unit,
            }
          : null,
        account: acc ? { id: acc.id, code: acc.code, name: acc.name } : null,
        taxGroup: g ? { id: g.id, name: g.name, supply: g.supply } : null,
      };
    }),
  };
  return {
    ...base,
    state: billState(
      {
        status: i.status,
        total: a.total,
        amountPaid: i.amountPaid,
        dueDate: i.dueDate,
      },
      today(),
    ),
  };
}

/** opts.approvalsAs: recording from the app as this role, so approval rules apply */
export function createDemoBillsApi(canManage: () => boolean, seeding = false, opts: { approvalsAs?: string } = {}): BillsApi {
  const load = () => loadRows(seeding);
  const guard = () => {
    if (!canManage())
      throw new ApiError('forbidden', 403, undefined, undefined, {
        missing: ['bills.manage'],
      });
  };
  const find = (rows: Stored[], iid: string) => {
    const i = rows.find((r) => r.id === iid);
    if (!i) throw new ApiError('not_found', 404);
    return i;
  };
  /** The same checks and line rules as the API */
  const prepare = (input: unknown): Omit<Stored, 'id' | 'number' | 'yearName' | 'status' | 'amountPaid' | 'journalEntryId' | 'journalNumber' | 'voidEntryId' | 'voidNumber'> => {
    const p = billDraftSchema.safeParse(input);
    if (!p.success)
      throw new ApiError('validation', 400, undefined, undefined, {
        fields: p.error.issues,
      });
    const d = p.data;
    const contact = demoContactRows().find((c) => c.id === d.contactId);
    if (!contact) throw refuse(400, 'contact_not_found', { field: 'contactId' });
    if (!contact.isVendor) throw refuse(400, 'not_vendor', { field: 'contactId' });
    if (contact.archived) throw refuse(400, 'contact_archived', { field: 'contactId' });
    const placeOfSupply = d.placeOfSupply ?? contact.stateCode;
    const supply = supplyFor(ORG_STATE, placeOfSupply);
    const items = demoItemRows();
    const accounts = demoAccountRows();
    const groups = allGroups();
    const lines = d.lines.map((l, n) => {
      const item = l.itemId ? items.find((x) => x.id === l.itemId) : undefined;
      if (l.itemId && !item) throw refuse(400, 'item_not_found');
      // Tracked goods are bought into their inventory account
      const accountId = demoInventoryAccountOf(l.itemId) ?? l.accountId ?? item?.expenseAccountId ?? null;
      if (!accountId) throw refuse(400, 'account_required', { line: n + 1 });
      if (!['expense', 'asset'].includes(accounts.find((a) => a.id === accountId)?.type ?? '')) throw refuse(400, 'not_expense', { line: n + 1 });
      let group = l.taxGroupId ? groups.find((g) => g.id === l.taxGroupId) : null;
      if (l.taxGroupId && !group) throw refuse(400, 'tax_group_not_found');
      if (group) group = groupForSupply(group, supply, groups);
      return {
        itemId: l.itemId,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPpm: l.discount,
        taxGroupId: group?.id ?? null,
        accountId,
        costCentreId: l.costCentreId ?? null,
      };
    });
    return {
      contactId: contact.id,
      billDate: d.billDate,
      dueDate: d.dueDate ?? dueDateFor(d.vendorBillDate ?? d.billDate, contact.paymentTermsDays),
      currency: contact.currency,
      rate: d.rate,
      placeOfSupply,
      vendorReference: d.vendorReference,
      vendorBillDate: d.vendorBillDate,
      notes: d.notes,
      lines,
    };
  };
  const api: BillsApi = {
    exportList: async (q) => {
      const all = (await api.list({ ...q, page: 1, pageSize: 10_000 })).items;
      const rows = [['number', 'state', 'bill_date', 'due_date', 'vendor', 'vendor_reference', 'vendor_bill_date', 'currency', 'total', 'paid', 'balance'], ...all.map((b) => { const cur = b.currency ?? 'INR'; return [b.number ?? 'Draft', b.state, b.billDate, b.dueDate, b.contact.name, b.vendorReference ?? '', b.vendorBillDate ?? '', cur, major(b.total, cur), b.status === 'open' ? major(b.amountPaid, cur) : '', b.status === 'open' ? major(b.balance, cur) : '']; })];
      return { blob: csvBlob(rows), filename: 'bills.csv' };
    },
    list: (q) =>
      wait(async () => {
        const all = (await load()).map(view);
        const s = q.search?.trim().toLowerCase();
        const items = all
          .filter((i) => !q.state || (q.state === 'unpaid' ? i.status === 'open' && i.balance > 0 : q.state === 'open' ? i.status === 'open' : i.state === q.state))
          .filter((i) => !q.contactId || i.contact.id === q.contactId)
          .filter((i) => !s || [i.number, i.vendorReference, i.contact.name].some((x) => x?.toLowerCase().includes(s)))
          .sort((a, b) => b.billDate.localeCompare(a.billDate) || (b.number ?? '').localeCompare(a.number ?? ''));
        const open = all.filter((i) => i.status === 'open' && i.balance > 0 && !i.currency);
        return {
          total: items.length,
          page: q.page,
          pageSize: q.pageSize,
          summary: {
            outstanding: open.reduce((t, i) => t + i.balance, 0),
            overdue: open.filter((i) => i.dueDate < today()).reduce((t, i) => t + i.balance, 0),
          },
          items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map((i) => ({
            id: i.id,
            number: i.number,
            status: i.status,
            state: i.state,
            contact: { id: i.contact.id, name: i.contact.name },
            billDate: i.billDate,
            dueDate: i.dueDate,
            currency: i.currency,
            total: i.total,
            amountPaid: i.amountPaid,
            balance: i.balance,
            vendorReference: i.vendorReference,
            vendorBillDate: i.vendorBillDate,
          })),
        };
      }),
    get: (iid) => wait(async () => view(find(await load(), iid))),
    create: (input) =>
      wait(async () => {
        guard();
        const rows = await load();
        const i: Stored = {
          id: crypto.randomUUID(),
          number: null,
          yearName: null,
          status: 'draft',
          amountPaid: 0,
          journalEntryId: null,
          journalNumber: null,
          voidEntryId: null,
          voidNumber: null,
          ...prepare(input),
        };
        rows.push(i);
        save(rows);
        return view(i);
      }),
    update: (iid, input) =>
      wait(async () => {
        guard();
        const rows = await load();
        const i = find(rows, iid);
        if (i.status !== 'draft') throw refuse(409, 'not_draft');
        Object.assign(i, prepare(input));
        save(rows);
        return view(i);
      }),
    remove: (iid) =>
      wait(async () => {
        guard();
        const rows = await load();
        if (find(rows, iid).status !== 'draft') throw refuse(409, 'not_draft');
        save(rows.filter((r) => r.id !== iid));
      }),
    duplicates: (iid) =>
      wait(async () => {
        const rows = await load();
        const me = view(find(rows, iid));
        const others = rows.map(view).filter((b) => b.contact.id === me.contact.id && b.status !== 'void');
        return possibleDuplicateBills(me, others).map((b) => ({ id: b.id, number: b.number, status: b.status, vendorReference: b.vendorReference, billDate: b.billDate, total: b.total, reason: b.reason }));
      }),
    record: (iid, recordOpts) =>
      wait(async () => {
        guard();
        const rows = await load();
        const i = find(rows, iid);
        if (i.status !== 'draft') throw refuse(409, 'not_draft');
        const v = view(i);
        if (!recordOpts?.allowDuplicate) {
          const same = possibleDuplicateBills(v, rows.map(view).filter((b) => b.contact.id === v.contact.id && b.status === 'open')).filter((b) => b.reason === 'reference');
          if (same.length) throw refuse(409, 'duplicate_bill', { duplicates: same.map((b) => ({ id: b.id, number: b.number, status: b.status, vendorReference: b.vendorReference, billDate: b.billDate, total: b.total, reason: b.reason })) });
        }
        if (opts.approvalsAs) demoApprovalCheck('bill', { documentId: iid, amount: v.total, summary: `Bill from ${v.contact.name}${v.vendorReference ? ` · ${v.vendorReference}` : ''}` }, opts.approvalsAs);
        if (v.total <= 0) throw refuse(400, 'zero_total');
        const payable = v.payableAccount;
        if (!payable) throw refuse(409, 'no_payable_account', { currency: i.currency });
        const { years } = await createDemoPeriodsApi(() => true).list();
        const year = years.find((y) => y.startDate <= i.billDate && i.billDate <= y.endDate);
        if (!year) throw refuse(409, 'no_period');
        const number = Math.max(0, ...rows.filter((r) => r.yearName === year.name && r.number).map((r) => r.number!)) + 1;
        const label = billNumber(year.name, number);
        let rate: string | null = null;
        if (i.currency) {
          rate = i.rate ?? demoRateOn(i.currency, i.billDate);
          if (!rate)
            throw refuse(400, 'no_rate', {
              currency: i.currency,
              date: i.billDate,
            });
        }
        const journals = createDemoJournalsApi(() => true);
        // Foreign bills keep the payable in their currency; costs are in rupees at the same rate
        const toInr = (minor: number) => (rate ? toBase(minor, rate, currencyDigits(i.currency!), 2) : minor);
        const lines = [
          ...v.lines
            .filter((l) => l.amount > 0)
            .map((l) => ({
              accountId: l.account!.id,
              description: l.description,
              debit: toInr(l.amount),
              taxGroupId: i.currency ? null : (l.taxGroup?.id ?? null),
              costCentreId: l.costCentre?.id ?? null,
            })),
          i.currency
            ? {
                accountId: payable.id,
                description: label,
                currency: i.currency,
                foreignCredit: v.total,
                rate: rate!,
              }
            : { accountId: payable.id, description: label, credit: v.total },
        ];
        const draft = await journals.create({
          date: i.billDate,
          memo: `Bill ${label} · ${v.contact.name}`,
          reference: i.vendorReference ?? label,
          lines,
        });
        const posted = await journals.post(draft.id).catch(async (e: unknown) => {
          await journals.remove(draft.id);
          throw e;
        });
        demoSaveMovements('bill', i.id, i.billDate, posted.id, demoStockReceipts(v.lines.map((l) => ({ itemId: l.item?.id ?? null, quantity: l.quantity, value: toInr(l.amount) }))));
        Object.assign(i, {
          status: 'open',
          number,
          yearName: year.name,
          rate,
          journalEntryId: posted.id,
          journalNumber: posted.number,
        });
        save(rows);
        return view(i);
      }),
    void: (iid, input) =>
      wait(async () => {
        guard();
        const rows = await load();
        const i = find(rows, iid);
        if (i.status !== 'open') throw refuse(409, 'not_open');
        if (i.amountPaid > 0) throw refuse(409, 'has_payments');
        demoCheckUndo('bill', i.id);
        const r = await createDemoJournalsApi(() => true).reverse(i.journalEntryId!, {
          date: input.date ?? today(),
          memo: `Bill voided${input.reason ? `: ${input.reason}` : ''}`,
        });
        demoUndoDocument('bill', i.id, input.date ?? today(), r.id);
        Object.assign(i, {
          status: 'void',
          voidEntryId: r.id,
          voidNumber: r.number,
        });
        save(rows);
        return view(i);
      }),
  };
  return api;
}
