export type Quote = {
  c: number;  // current price
  d: number;  // change
  dp: number; // change percent
  h: number;  // high of the day
  l: number;  // low of the day
  o: number;  // open price
  pc: number; // previous close
};

export type Profile = {
  name: string;
  ticker: string;
  exchange: string;
  currency: string;
  marketCapitalization: number;
  logo: string;
};

export type Metric = {
  metric: {
    '52WeekHigh': number;
    '52WeekLow': number;
    peBasicExclExtraTTM: number;
    epsBasicExclExtraAnnual: number;
  };
};

export type StockData = {
  ticker: string;
  name: string;
  exchange: string;
  currency: string;
  currentPrice: number;
  prevClose: number;
  changePercent: number;
  high52w: number;
  low52w: number;
  pe: number | null;
  eps: number | null;
  marketCap: number;
};
