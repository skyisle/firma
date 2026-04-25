// ── Balance sheet categories (asset / liability) ─────────────────────────────

export type BalanceType = 'asset' | 'liability';

export type BalanceCategory = {
  type: BalanceType;
  subType: string;
  category: string;
  label: string;
  autoFilled?: boolean;
};

export const BALANCE_CATEGORIES: BalanceCategory[] = [
  { type: 'asset', subType: 'cash',       category: 'cash',           label: 'Cash' },
  { type: 'asset', subType: 'cash',       category: 'savings',        label: 'Savings & Deposits' },
  { type: 'asset', subType: 'cash',       category: 'housing_sub',    label: 'Housing Subscription' },
  { type: 'asset', subType: 'cash',       category: 'cash_other',     label: 'Other Cash' },
  { type: 'asset', subType: 'investment', category: 'domestic_stock', label: 'Domestic Stocks' },
  { type: 'asset', subType: 'investment', category: 'overseas_stock', label: 'Overseas Stocks', autoFilled: true },
  { type: 'asset', subType: 'investment', category: 'real_estate',    label: 'Real Estate' },
  { type: 'asset', subType: 'investment', category: 'pension',        label: 'Pension' },
  { type: 'asset', subType: 'other',      category: 'vehicle',        label: 'Vehicle' },
  { type: 'asset', subType: 'other',      category: 'deposit',        label: 'Security Deposit' },
  { type: 'asset', subType: 'other',      category: 'asset_other',    label: 'Other Assets' },

  { type: 'liability', subType: 'short_term', category: 'credit_card',      label: 'Credit Card' },
  { type: 'liability', subType: 'short_term', category: 'short_term_other', label: 'Other Short-term' },
  { type: 'liability', subType: 'long_term',  category: 'loan',             label: 'Loan' },
  { type: 'liability', subType: 'long_term',  category: 'long_term_other',  label: 'Other Long-term' },
];

// ── Cash flow categories (income / expense) ───────────────────────────────────

export type FlowType = 'income' | 'expense';

export type FlowCategory = {
  type: FlowType;
  subType: string;
  category: string;
  label: string;
};

export const FLOW_CATEGORIES: FlowCategory[] = [
  { type: 'income', subType: 'employment', category: 'salary',          label: 'Salary' },
  { type: 'income', subType: 'employment', category: 'business',        label: 'Business Income' },
  { type: 'income', subType: 'investment', category: 'dividends',       label: 'Dividends' },
  { type: 'income', subType: 'investment', category: 'interest',        label: 'Interest' },
  { type: 'income', subType: 'other',      category: 'income_other',    label: 'Other Income' },

  { type: 'expense', subType: 'consumption', category: 'personal',       label: 'Personal Spending' },
  { type: 'expense', subType: 'fixed',       category: 'insurance',      label: 'Insurance' },
  { type: 'expense', subType: 'fixed',       category: 'phone',          label: 'Phone' },
  { type: 'expense', subType: 'fixed',       category: 'utilities',      label: 'Utilities' },
  { type: 'expense', subType: 'housing',     category: 'rent',           label: 'Rent' },
  { type: 'expense', subType: 'housing',     category: 'maintenance',    label: 'Maintenance Fee' },
  { type: 'expense', subType: 'debt',        category: 'loan_repayment', label: 'Loan Repayment' },
  { type: 'expense', subType: 'other',       category: 'expense_other',  label: 'Other Expenses' },
];
