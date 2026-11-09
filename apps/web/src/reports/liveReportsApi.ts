import type { AuthClient } from '../auth/client';
import type { ReportsApi } from './types';

/** Reports backed by the real API, always for one organisation. */
export function createLiveReportsApi(client: AuthClient, organizationId: string): ReportsApi {
  const headers = { 'X-Organization-Id': organizationId };
  const r = <T>(path: string) => client.request<T>(`/reports${path}`, { headers });
  const file = async (path: string, fallback: string) => {
    const { blob, filename } = await client.download(`/reports${path}`, { headers });
    return { blob, filename: filename ?? fallback };
  };
  return {
    trialBalance: (asOf) => r(`/trial-balance?asOf=${asOf}`),
    ledger: (accountId, from, to) => r(`/ledger?accountId=${accountId}&from=${from}&to=${to}`),
    exportTrialBalance: (asOf) => file(`/trial-balance/export?asOf=${asOf}`, `trial-balance-${asOf}.csv`),
    exportLedger: (accountId, from, to) => file(`/ledger/export?accountId=${accountId}&from=${from}&to=${to}`, `ledger-${from}-${to}.csv`),
    taxSummary: (from, to) => r(`/tax-summary?from=${from}&to=${to}`),
    exportTaxSummary: (from, to) => file(`/tax-summary/export?from=${from}&to=${to}`, `tax-summary-${from}-${to}.csv`),
    aging: (side, asOf) => r(`/aging?side=${side}&asOf=${asOf}`),
    exportAging: (side, asOf) => file(`/aging/export?side=${side}&asOf=${asOf}`, `${side}-aging-${asOf}.csv`),
    sales: (side, by, from, to) => r(`/sales?side=${side}&by=${by}&from=${from}&to=${to}`),
    exportSales: (side, by, from, to) => file(`/sales/export?side=${side}&by=${by}&from=${from}&to=${to}`, `${side}-by-${by}-${from}-${to}.csv`),
    statement: (contactId, side, from, to) => r(`/statement?contactId=${contactId}&side=${side}&from=${from}&to=${to}`),
    exportStatement: (contactId, side, from, to, format) => file(`/statement/export?contactId=${contactId}&side=${side}&from=${from}&to=${to}&format=${format}`, `statement-${from}-${to}.${format}`),
    emailStatement: (input) => client.request(`/reports/statement/email`, { method: 'POST', json: input, headers }),
    dashboard: () => r('/dashboard'),
    gstr3b: (from, to) => r(`/gst/gstr-3b?from=${from}&to=${to}`),
    gstr1: (from, to) => r(`/gst/gstr-1?from=${from}&to=${to}`),
    exportGstr1: (from, to, format) => file(`/gst/gstr-1/export?from=${from}&to=${to}&format=${format}`, `gstr-1-${from}-${to}.${format}`),
    cashFlow: (from, to) => r(`/cash-flow?from=${from}&to=${to}`),
    exportCashFlow: (from, to) => file(`/cash-flow/export?from=${from}&to=${to}`, `cash-flow-${from}-${to}.csv`),
    profitAndLoss: (from, to, compare, costCentreId) => r(`/profit-and-loss?from=${from}&to=${to}&compare=${compare}${costCentreId ? `&costCentreId=${costCentreId}` : ''}`),
    exportProfitAndLoss: (from, to, compare, costCentreId) => file(`/profit-and-loss/export?from=${from}&to=${to}&compare=${compare}${costCentreId ? `&costCentreId=${costCentreId}` : ''}`, `profit-and-loss-${from}-${to}.csv`),
    balanceSheet: (asOf, compareAsOf) => r(`/balance-sheet?asOf=${asOf}${compareAsOf ? `&compareAsOf=${compareAsOf}` : ''}`),
    exportBalanceSheet: (asOf, compareAsOf) => file(`/balance-sheet/export?asOf=${asOf}${compareAsOf ? `&compareAsOf=${compareAsOf}` : ''}`, `balance-sheet-${asOf}.csv`),
  };
}
