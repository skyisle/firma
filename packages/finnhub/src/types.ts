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

export type NewsItem = {
  id: number;
  category: string;
  datetime: number;
  headline: string;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
};

export type InsiderTransaction = {
  name: string;
  share: number;
  change: number;
  filingDate: string;
  transactionDate: string;
  transactionCode: string;
  transactionPrice: number;
};

export type InsiderTransactionsResponse = {
  data: InsiderTransaction[];
  symbol: string;
};

export type EarningsItem = {
  date: string;
  epsActual: number | null;
  epsEstimate: number | null;
  hour: string;
  quarter: number;
  revenueActual: number | null;
  revenueEstimate: number | null;
  symbol: string;
  year: number;
};

export type EarningsCalendarResponse = {
  earningsCalendar: EarningsItem[];
};

export type FinancialLineItem = {
  concept: string;
  label: string;
  unit: string;
  value: number;
};

export type FinancialReport = {
  bs: FinancialLineItem[];
  cf: FinancialLineItem[];
  ic: FinancialLineItem[];
};

export type FinancialPeriod = {
  accessNumber: string;
  symbol: string;
  cik: string;
  year: number;
  quarter: number;
  form: string;
  startDate: string;
  endDate: string;
  filedDate: string;
  acceptedDate: string;
  report: FinancialReport;
};

export type FinancialsReportedResponse = {
  cik: string;
  data: FinancialPeriod[];
  symbol: string;
};
