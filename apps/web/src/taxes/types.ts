import type { GstSlabCreateInput, GstSlabUpdateInput, TaxGroupCreateInput, TaxKind, TaxRateCreateInput, TaxRateUpdateInput } from '@ledgernest/shared';

export interface AccountRef {
  id: string;
  code: string;
  name: string;
}

export interface TaxRate {
  id: string;
  name: string;
  kind: TaxKind;
  ratePpm: number;
  /** "9%" */
  rate: string;
  outputAccount: AccountRef;
  inputAccount: AccountRef | null;
  archived: boolean;
  groupCount: number;
}

export interface TaxGroup {
  id: string;
  name: string;
  /** intra = within the state (CGST + SGST), inter = between states (IGST) */
  supply: 'intra' | 'inter' | null;
  gstSlab: { id: string; rate: string; label: string; effectiveFrom: string; effectiveTo: string | null } | null;
  archived: boolean;
  totalPpm: number;
  total: string;
  rates: { id: string; name: string; kind: TaxKind; ratePpm: number; rate: string; archived: boolean }[];
}

export interface GstSlab {
  id: string;
  ratePpm: number;
  rate: string;
  label: string;
  description: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** Organisations' tax groups made from it */
  usage: number;
}

export interface GstStatus {
  state: { code: string; name: string } | null;
  utgst: boolean;
  slabs: (GstSlab & { inForce: boolean; setUp: boolean })[];
}

export interface TaxesResponse {
  rates: TaxRate[];
  groups: TaxGroup[];
  /** Only for organisations in India */
  gst: GstStatus | null;
}

export interface GstSetupResult extends TaxesResponse {
  created: { state: string | null; utgst: boolean; accounts: string[]; rates: string[]; groups: string[] };
}

export interface TaxesApi {
  list(): Promise<TaxesResponse>;
  setupGst(slabIds?: string[]): Promise<GstSetupResult>;
  /** Compensation cess on top of a GST rate: the cess rate and a group within the state and between states */
  addCess(input: { gstRatePpm: number; cessRatePpm: number }): Promise<TaxesResponse & { created: { groups: string[] } }>;
  createRate(input: TaxRateCreateInput): Promise<TaxRate>;
  updateRate(id: string, patch: TaxRateUpdateInput): Promise<TaxRate>;
  archiveRate(id: string, archive: boolean): Promise<TaxRate>;
  createGroup(input: TaxGroupCreateInput): Promise<TaxGroup>;
  renameGroup(id: string, name: string): Promise<TaxGroup>;
  archiveGroup(id: string, archive: boolean): Promise<TaxGroup>;
}

/** The Super Admin's list of India's GST slabs. */
export interface GstSlabsApi {
  list(): Promise<GstSlab[]>;
  create(input: GstSlabCreateInput): Promise<GstSlab>;
  update(id: string, patch: GstSlabUpdateInput): Promise<GstSlab>;
  remove(id: string): Promise<void>;
}
