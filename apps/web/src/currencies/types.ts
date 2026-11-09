export interface RateView {
  date: string;
  /** 1 unit of the currency in the base currency, e.g. "93.93" */
  rate: string;
  /** manual = typed by hand; ecb = fetched from the European Central Bank */
  source: 'manual' | 'ecb';
}

export interface EnabledCurrency {
  code: string;
  digits: number;
  rateCount: number;
  latest: RateView | null;
}

export interface CurrenciesResponse {
  base: string;
  today: string;
  currencies: EnabledCurrency[];
}

export interface FetchResult {
  saved: { code: string; date: string; rate: string }[];
  /** Kept because a rate was typed by hand for that day */
  keptManual: string[];
  /** Not covered by the ECB: type these by hand */
  unsupported: string[];
  failed: number;
}

export interface RevalueResult {
  date: string;
  entry: { id: string; number: string } | null;
  adjustments: { accountId: string; code: string; name: string; currency: string; foreignBalance: number; rate: string; before: number; after: number; difference: number }[];
  missingRates: string[];
}

/** Foreign currencies and exchange rates. Live and demo both implement it. */
export interface CurrenciesApi {
  list(): Promise<CurrenciesResponse>;
  add(code: string): Promise<CurrenciesResponse>;
  remove(code: string): Promise<void>;
  rates(code: string): Promise<(RateView & { updatedAt?: string })[]>;
  setRate(code: string, date: string, rate: string): Promise<RateView>;
  removeRate(code: string, date: string): Promise<void>;
  fetchRates(date?: string): Promise<FetchResult>;
  revalue(date: string): Promise<RevalueResult>;
}
