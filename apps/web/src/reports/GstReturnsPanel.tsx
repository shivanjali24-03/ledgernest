import type { ReactNode } from 'react';
import { INDIAN_STATES } from '@ledgernest/shared';
import { Receipt } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../i18n';
import { formatDate } from '../lib/format';
import { useMoney } from '../lib/useMoney';
import { Card, EmptyState, ErrorState, SkeletonRows } from '../ui/Kit';
import type { GstHeads, GstRateRow, Gstr1, Gstr3b } from './types';

const th = 'px-3 py-2 font-semibold';
const num = 'px-3 py-1.5 text-end font-mono tabular-nums';
const HEADS = ['igst', 'cgst', 'sgst', 'cess'] as const;

function Loading({ isPending, isError, onRetry }: { isPending: boolean; isError: boolean; onRetry: () => void }) {
  if (isPending)
    return (
      <Card>
        <SkeletonRows rows={6} />
      </Card>
    );
  return isError ? (
    <Card>
      <ErrorState onRetry={onRetry} />
    </Card>
  ) : null;
}

/** A titled table of a return's figures */
function Block({ title, caption, head, children }: { title: string; caption?: string; head: ReactNode; children: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-ink-100 px-4 py-3 dark:border-ink-800">
        <h3 className="font-semibold">{title}</h3>
        {caption && <p className="text-xs text-ink-500">{caption}</p>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <caption className="sr-only">{title}</caption>
          <thead className="text-xs uppercase tracking-wide text-ink-400">{head}</thead>
          <tbody className="divide-y divide-ink-100 dark:divide-ink-800">{children}</tbody>
        </table>
      </div>
    </Card>
  );
}

/** GSTR-3B: what was supplied and the tax on it, the credit on purchases, and what's paid in cash after set-off. */
export function Gstr3bPanel({ data, ...state }: { data: Gstr3b | undefined; isPending: boolean; isError: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  const money = useMoney();
  if (!data) return <Loading {...state} />;
  const k = (s: string) => t(`reports.gst.${s}`);
  const heads = (h: GstHeads) => HEADS.map((x) => <td key={x} className={num} dir="ltr">{h[x] ? money.plain(h[x]) : '–'}</td>);
  const headCols = HEADS.map((x) => (
    <th key={x} scope="col" className={`${th} text-end`}>
      {k(`heads.${x}`)}
    </th>
  ));
  return (
    <div className="space-y-4">
      <Block title={k('r3b.outwardTitle')} head={<tr><th scope="col" className={`${th} text-start`}>{k('nature')}</th><th scope="col" className={`${th} text-end`}>{k('taxable')}</th>{headCols}</tr>}>
        <tr>
          <td className="px-3 py-1.5">{k('r3b.outward')}</td>
          <td className={num} dir="ltr">{money.plain(data.outward.taxable)}</td>
          {heads(data.outward)}
        </tr>
        <tr>
          <td className="px-3 py-1.5">{k('r3b.untaxed')}</td>
          <td className={num} dir="ltr">{money.plain(data.outwardUntaxed)}</td>
          {heads({ igst: 0, cgst: 0, sgst: 0, cess: 0 })}
        </tr>
        {data.inwardReverseCharge && (
          <tr>
            <td className="px-3 py-1.5">{k('r3b.reverseCharge')}</td>
            <td className={num} dir="ltr">{money.plain(data.inwardReverseCharge.taxable)}</td>
            {heads(data.inwardReverseCharge)}
          </tr>
        )}
      </Block>
      <Block title={k('r3b.itcTitle')} head={<tr><th scope="col" className={`${th} text-start`}>{k('details')}</th><th scope="col" className={`${th} text-end`}>{k('taxable')}</th>{headCols}</tr>}>
        <tr>
          <td className="px-3 py-1.5">{k('r3b.itc')}</td>
          <td className={num} dir="ltr">{money.plain(data.inwardTaxable)}</td>
          {heads(data.itc)}
        </tr>
        {data.itcReversed &&
          (['blocked', 'ineligible', 'unpaid180'] as const)
            .filter((x) => HEADS.some((h) => data.itcReversed![x]?.[h]))
            .map((x) => (
              <tr key={x}>
                <td className="px-3 py-1.5">{k(`r3b.reversed.${x}`)}</td>
                <td className={num} dir="ltr" />
                {heads(data.itcReversed![x]!)}
              </tr>
            ))}
        {data.itcReclaimed && HEADS.some((h) => data.itcReclaimed![h]) && (
          <tr>
            <td className="px-3 py-1.5">{k('r3b.reclaimed')}</td>
            <td className={num} dir="ltr" />
            {heads(data.itcReclaimed)}
          </tr>
        )}
      </Block>
      <Block title={k('r3b.paymentTitle')} caption={k('r3b.paymentHint')} head={<tr><th scope="col" className={`${th} text-start`}>{k('head')}</th><th scope="col" className={`${th} text-end`}>{k('r3b.tax')}</th><th scope="col" className={`${th} text-end`}>{k('r3b.byIgst')}</th><th scope="col" className={`${th} text-end`}>{k('r3b.byCgst')}</th><th scope="col" className={`${th} text-end`}>{k('r3b.bySgst')}</th><th scope="col" className={`${th} text-end`}>{k('r3b.cash')}</th></tr>}>
        {HEADS.map((h) => (
          <tr key={h}>
            <th scope="row" className="px-3 py-1.5 text-start font-normal">{k(`heads.${h}`)}</th>
            <td className={num} dir="ltr">{money.plain(data.outward[h] + (data.inwardReverseCharge?.[h] ?? 0))}</td>
            {(['igst', 'cgst', 'sgst'] as const).map((from) => (
              <td key={from} className={num} dir="ltr">{data.setOff.used[from][h] ? money.plain(data.setOff.used[from][h]) : '–'}</td>
            ))}
            <td className={`${num} font-semibold`} dir="ltr">{money.plain(data.payable[h])}</td>
          </tr>
        ))}
        <tr className="font-semibold">
          <td className="px-3 py-2" colSpan={5}>{k('r3b.totalCash')}</td>
          <td className={num} dir="ltr">{money.format(HEADS.reduce((s, h) => s + data.payable[h], 0))}</td>
        </tr>
      </Block>
      {HEADS.some((h) => data.carriedForward[h]) && (
        <p className="text-sm text-ink-600 dark:text-ink-300">
          {t('reports.gst.r3b.carried', { amounts: HEADS.filter((h) => data.carriedForward[h]).map((h) => `${k(`heads.${h}`)} ${money.format(data.carriedForward[h])}`).join(', ') })}
        </p>
      )}
    </div>
  );
}

/** GSTR-1: each kind of outward supply as the return lays it out, then the HSN summary and documents issued. */
export function Gstr1Panel({ data, onJson, ...state }: { data: Gstr1 | undefined; isPending: boolean; isError: boolean; onRetry: () => void; onJson?: () => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  if (!data) return <Loading {...state} />;
  const k = (s: string) => t(`reports.gst.${s}`);
  const day = (d: string) => formatDate(`${d}T00:00:00Z`, locale);
  const pos = (code: string | null) => (code ? `${code} · ${INDIAN_STATES.find((s) => s.code === code)?.name ?? ''}` : '—');
  const amounts = (r: GstRateRow) => (
    <>
      <td className={num} dir="ltr">{r.rate}%</td>
      <td className={num} dir="ltr">{money.plain(r.taxable)}</td>
      {HEADS.map((h) => (
        <td key={h} className={num} dir="ltr">{r[h] ? money.plain(r[h]) : '–'}</td>
      ))}
    </>
  );
  const amountCols = (
    <>
      <th scope="col" className={`${th} text-end`}>{k('rate')}</th>
      <th scope="col" className={`${th} text-end`}>{k('taxable')}</th>
      {HEADS.map((h) => (
        <th key={h} scope="col" className={`${th} text-end`}>{k(`heads.${h}`)}</th>
      ))}
    </>
  );
  const empty = !data.b2b.length && !data.b2cl.length && !data.b2cs.length && !data.exports.length && !data.cdnr.length && !data.cdnur.length;
  if (empty)
    return (
      <Card>
        <EmptyState icon={<Receipt className="size-5" />} title={k('r1.empty')} body={k('r1.emptyBody')} />
      </Card>
    );
  const docHead = (party: boolean) => (
    <tr>
      {party && <th scope="col" className={`${th} text-start`}>{k('r1.party')}</th>}
      <th scope="col" className={`${th} text-start`}>{k('r1.document')}</th>
      <th scope="col" className={`${th} text-start`}>{k('r1.pos')}</th>
      {amountCols}
    </tr>
  );
  return (
    <div className="space-y-4">
      {onJson && (
        <div className="flex justify-end">
          <button type="button" onClick={onJson} className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
            {k('r1.json')}
          </button>
        </div>
      )}
      {data.b2b.length > 0 && (
        <Block title={k('r1.b2b')} caption={k('r1.b2bHint')} head={docHead(true)}>
          {data.b2b.flatMap((i) =>
            i.items.map((r) => (
              <tr key={`${i.number}-${r.rate}`}>
                <td className="px-3 py-1.5"><span dir="auto">{i.name}</span><span className="block font-mono text-xs text-ink-500">{i.gstin}</span></td>
                <td className="px-3 py-1.5"><span className="font-mono" dir="ltr">{i.number}</span><span className="block text-xs text-ink-500">{day(i.date)}</span></td>
                <td className="px-3 py-1.5 text-ink-600 dark:text-ink-300">{pos(i.placeOfSupply)}</td>
                {amounts(r)}
              </tr>
            )),
          )}
        </Block>
      )}
      {data.b2cl.length > 0 && (
        <Block title={k('r1.b2cl')} caption={k('r1.b2clHint')} head={docHead(false)}>
          {data.b2cl.flatMap((i) => i.items.map((r) => (
            <tr key={`${i.number}-${r.rate}`}>
              <td className="px-3 py-1.5"><span className="font-mono" dir="ltr">{i.number}</span><span className="block text-xs text-ink-500">{day(i.date)}</span></td>
              <td className="px-3 py-1.5">{pos(i.placeOfSupply)}</td>
              {amounts(r)}
            </tr>
          )))}
        </Block>
      )}
      {data.b2cs.length > 0 && (
        <Block title={k('r1.b2cs')} caption={k('r1.b2csHint')} head={<tr><th scope="col" className={`${th} text-start`}>{k('r1.pos')}</th><th scope="col" className={`${th} text-start`}>{k('r1.supply')}</th>{amountCols}</tr>}>
          {data.b2cs.map((r) => (
            <tr key={`${r.placeOfSupply}-${r.rate}`}>
              <td className="px-3 py-1.5">{pos(r.placeOfSupply)}</td>
              <td className="px-3 py-1.5">{k(`r1.${r.type}`)}</td>
              {amounts(r)}
            </tr>
          ))}
        </Block>
      )}
      {data.exports.length > 0 && (
        <Block title={k('r1.exports')} head={docHead(false)}>
          {data.exports.flatMap((i) => i.items.map((r) => (
            <tr key={`${i.number}-${r.rate}`}>
              <td className="px-3 py-1.5"><span className="font-mono" dir="ltr">{i.number}</span><span className="block text-xs text-ink-500">{day(i.date)}{i.currency && ` · ${i.currency}`}</span></td>
              <td className="px-3 py-1.5">—</td>
              {amounts(r)}
            </tr>
          )))}
        </Block>
      )}
      {(data.cdnr.length > 0 || data.cdnur.length > 0) && (
        <Block title={k('r1.notes')} head={docHead(true)}>
          {[...data.cdnr.map((n) => ({ ...n, gstin: n.gstin as string | null })), ...data.cdnur.map((n) => ({ ...n, gstin: null }))].flatMap((n) => n.items.map((r) => (
            <tr key={`${n.number}-${r.rate}`}>
              <td className="px-3 py-1.5"><span dir="auto">{n.name}</span>{n.gstin && <span className="block font-mono text-xs text-ink-500">{n.gstin}</span>}</td>
              <td className="px-3 py-1.5"><span className="font-mono" dir="ltr">{n.number}</span><span className="block text-xs text-ink-500">{day(n.date)}{n.invoice && ` · ${n.invoice}`}</span></td>
              <td className="px-3 py-1.5">—</td>
              {amounts(r)}
            </tr>
          )))}
        </Block>
      )}
      {data.hsn.length > 0 && (
        <Block title={k('r1.hsn')} head={<tr><th scope="col" className={`${th} text-start`}>HSN/SAC</th><th scope="col" className={`${th} text-end`}>{k('r1.quantity')}</th>{amountCols}</tr>}>
          {data.hsn.map((h) => (
            <tr key={`${h.hsn}-${h.rate}`}>
              <td className="px-3 py-1.5 font-mono">{h.hsn || k('r1.noHsn')}</td>
              <td className={num} dir="ltr">{h.returned ? '−' : ''}{h.quantity}{h.unit ? ` ${h.unit}` : ''}</td>
              {amounts(h)}
            </tr>
          ))}
        </Block>
      )}
      {(data.docIssue?.length ?? 0) > 0 && (
        <Block
          title={k('r1.docIssue')}
          head={
            <tr>
              <th scope="col" className={`${th} text-start`}>{k('r1.docType')}</th>
              <th scope="col" className={`${th} text-start`}>{k('r1.docSeries')}</th>
              <th scope="col" className={`${th} text-start`}>{k('r1.docFrom')}</th>
              <th scope="col" className={`${th} text-start`}>{k('r1.docTo')}</th>
              <th scope="col" className={`${th} text-end`}>{k('r1.docTotal')}</th>
              <th scope="col" className={`${th} text-end`}>{k('r1.docCancelled')}</th>
              <th scope="col" className={`${th} text-end`}>{k('r1.docNet')}</th>
            </tr>
          }
        >
          {data.docIssue!.map((d) => (
            <tr key={`${d.type}-${d.series}`}>
              <td className="px-3 py-1.5">{k(`r1.docTypes.${d.type}`)}</td>
              <td className="px-3 py-1.5">{d.series}</td>
              <td className="px-3 py-1.5 font-mono" dir="ltr">{d.from}</td>
              <td className="px-3 py-1.5 font-mono" dir="ltr">{d.to}</td>
              <td className={num} dir="ltr">{d.total}</td>
              <td className={num} dir="ltr">{d.cancelled}</td>
              <td className={num} dir="ltr">{d.total - d.cancelled}</td>
            </tr>
          ))}
        </Block>
      )}
      <p className="text-sm text-ink-600 dark:text-ink-300">
        {t('reports.gst.r1.documents', { total: data.documents.invoices.total, first: data.documents.invoices.first ?? '—', last: data.documents.invoices.last ?? '—', cancelled: data.documents.invoices.cancelled, notes: data.documents.creditNotes.total })}
      </p>
    </div>
  );
}
