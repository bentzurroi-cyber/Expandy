import type { Language } from "@/context/I18nContext";

/** English display names for built-in expense category IDs (DB ids unchanged). */
const EXPENSE_CATEGORY_EN: Record<string, string> = {
  "cat-groceries": "Groceries & supermarket",
  "cat-transport": "Transport",
  "cat-dining": "Restaurants & coffee",
  "cat-utilities": "Bills & services",
  "cat-health": "Health",
  "cat-entertainment": "Entertainment",
};

const INCOME_SOURCE_EN: Record<string, string> = {
  "inc-salary": "Salary",
  "inc-training": "Personal training",
  "inc-freelance": "Freelance",
};

const PAYMENT_METHOD_EN: Record<string, string> = {
  "pm-roy-credit": "Roy's credit card",
  "pm-noy-credit": "Noy's credit card",
  "pm-roy-bit": "Roy's Bit",
};

const DESTINATION_ACCOUNT_EN: Record<string, string> = {
  "acc-leumi": "Bank Leumi",
  "acc-joint": "Joint account",
  "acc-cash": "Cash",
};

const ASSET_TYPE_EN: Record<string, string> = {
  liquid: "Liquid accounts",
  portfolio: "Investment portfolios",
  pension: "Pension / study fund",
};

export function localizedExpenseCategoryName(id: string, storedName: string, lang: Language): string {
  if (lang === "en" && EXPENSE_CATEGORY_EN[id]) return EXPENSE_CATEGORY_EN[id]!;
  return storedName;
}

export function localizedIncomeSourceName(id: string, storedName: string, lang: Language): string {
  if (lang === "en" && INCOME_SOURCE_EN[id]) return INCOME_SOURCE_EN[id]!;
  return storedName;
}

export function localizedPaymentMethodName(id: string, storedName: string, lang: Language): string {
  if (lang === "en" && PAYMENT_METHOD_EN[id]) return PAYMENT_METHOD_EN[id]!;
  return storedName;
}

export function localizedDestinationAccountName(id: string, storedName: string, lang: Language): string {
  if (lang === "en" && DESTINATION_ACCOUNT_EN[id]) return DESTINATION_ACCOUNT_EN[id]!;
  return storedName;
}

export function localizedAssetTypeName(id: string, storedName: string, lang: Language): string {
  if (lang === "en" && ASSET_TYPE_EN[id]) return ASSET_TYPE_EN[id]!;
  return storedName;
}
