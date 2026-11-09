import type { DepreciationMethod, FixedAssetInput } from '@ledgernest/shared';

type AccountRef = { id: string; code: string; name: string };
export interface FixedAsset {
  id: string;
  name: string;
  tag: string;
  description: string | null;
  cost: number;
  residual: number;
  inServiceDate: string;
  method: DepreciationMethod;
  usefulLifeMonths: number | null;
  /** Yearly, as a percentage */
  wdvRate: number | null;
  openingAccumulated: number;
  accumulated: number;
  bookValue: number;
  depreciatedTo: string | null;
  status: 'active' | 'disposed';
  disposedOn: string | null;
  proceeds: number | null;
  costAccount: AccountRef;
  accumulatedAccount: AccountRef;
  expenseAccount: AccountRef;
  disposalEntry: { id: string; number: string | null } | null;
}
export interface DepreciationRun {
  id: string;
  upTo: string;
  total: number;
  journalEntry: { id: string; number: string | null };
  lines: { asset: { id: string; tag: string; name: string }; from: string; to: string; amount: number }[];
}
export interface AssetSchedule {
  from: string;
  to: string;
  rows: { assetId: string; tag: string; name: string; openingCost: number; additions: number; disposals: number; closingCost: number; openingDepreciation: number; depreciation: number; depreciationOnDisposals: number; closingDepreciation: number; closingBookValue: number }[];
  totals: Record<'openingCost' | 'additions' | 'disposals' | 'closingCost' | 'openingDepreciation' | 'depreciation' | 'depreciationOnDisposals' | 'closingDepreciation' | 'closingBookValue', number>;
}

/** The fixed asset register. Live and demo both implement it. */
export interface AssetsApi {
  list(): Promise<FixedAsset[]>;
  create(input: FixedAssetInput): Promise<FixedAsset>;
  remove(id: string): Promise<void>;
  preview(upTo: string): Promise<{ upTo: string; total: number; lines: { assetId: string; tag: string; name: string; from: string; to: string; amount: number }[] }>;
  run(upTo: string): Promise<DepreciationRun>;
  runs(): Promise<DepreciationRun[]>;
  undoRun(id: string): Promise<void>;
  dispose(id: string, input: { date: string; proceeds: number; bankAccountId: string | null; gainLossAccountId: string }): Promise<FixedAsset>;
  schedule(from: string, to: string): Promise<AssetSchedule>;
}
