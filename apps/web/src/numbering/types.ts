import type { NumberSeries, NumberSeriesInput, NumberSeriesUpdate } from '@ledgernest/shared';

export interface NumberSeriesList {
  /** The financial year previews are written for */
  yearName: string;
  items: NumberSeries[];
}

export interface NumberingApi {
  list(): Promise<NumberSeriesList>;
  create(input: NumberSeriesInput): Promise<NumberSeries>;
  update(id: string, patch: NumberSeriesUpdate): Promise<NumberSeries>;
  remove(id: string): Promise<void>;
}
