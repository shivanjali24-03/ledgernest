import type { CostCentreInput, CostCentreKind } from '@ledgernest/shared';

export interface CostCentre {
  id: string;
  code: string;
  name: string;
  kind: CostCentreKind;
  description: string | null;
  archived: boolean;
  /** How many journal lines are tagged with it */
  lines?: number;
}
export type CostCentreRef = { id: string; code: string; name: string };

/** Cost centres and projects. Live and demo both implement it. */
export interface CostCentresApi {
  list(includeArchived: boolean): Promise<CostCentre[]>;
  create(input: CostCentreInput): Promise<CostCentre>;
  update(id: string, input: CostCentreInput): Promise<CostCentre>;
  archive(id: string, archived: boolean): Promise<CostCentre>;
  remove(id: string): Promise<void>;
}
