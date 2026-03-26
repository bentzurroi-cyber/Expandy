export type CurrencyCode = string;
export type EntryType = "expense" | "income";

export type CurrencyDef = {
  code: CurrencyCode;
  /** שם קצר בעברית — ללא סוגריים (הסימול מוצג בנפרד) */
  labelHe: string;
  symbol: string;
  /** מפתח לאייקון Lucide מונוכרומי */
  iconKey: string;
};

export const CURRENCIES: CurrencyDef[] = [
  { code: "ILS", labelHe: "שקל", symbol: "₪", iconKey: "ils" },
  { code: "USD", labelHe: "דולר", symbol: "$", iconKey: "dollar-sign" },
  { code: "EUR", labelHe: "יורו", symbol: "€", iconKey: "euro" },
];

export const DEFAULT_CURRENCY: CurrencyCode = "ILS";

export type Category = {
  id: string;
  name: string;
  /** CSS color (hex or hsl) for badge */
  color: string;
  /** מפתח לאייקון Lucide מונוכרומי */
  iconKey: string;
};

export const MOCK_CATEGORIES: Category[] = [
  { id: "cat-groceries", name: "מכולת וסופר", color: "#34d399", iconKey: "shopping-cart" },
  { id: "cat-transport", name: "תחבורה", color: "#38bdf8", iconKey: "car" },
  { id: "cat-dining", name: "מסעדות וקפה", color: "#fb923c", iconKey: "utensils" },
  { id: "cat-utilities", name: "חשבונות ושירותים", color: "#a78bfa", iconKey: "zap" },
  { id: "cat-health", name: "בריאות", color: "#fb7185", iconKey: "heart-pulse" },
  { id: "cat-entertainment", name: "בילויים", color: "#fbbf24", iconKey: "clapperboard" },
];

export const MOCK_INCOME_SOURCES: Category[] = [
  { id: "inc-salary", name: "משכורת", color: "#22c55e", iconKey: "briefcase" },
  { id: "inc-training", name: "אימונים אישיים", color: "#0ea5e9", iconKey: "dumbbell" },
  { id: "inc-freelance", name: "פרילנס", color: "#f59e0b", iconKey: "laptop" },
];

export type PaymentMethod = {
  id: string;
  name: string;
  color: string;
  /** מפתח לאייקון Lucide מונוכרומי */
  iconKey: string;
};

export const MOCK_PAYMENT_METHODS: PaymentMethod[] = [
  { id: "pm-roy-credit", name: "אשראי רועי", color: "#60a5fa", iconKey: "credit-card" },
  { id: "pm-noy-credit", name: "אשראי נוי", color: "#c084fc", iconKey: "credit-card" },
  { id: "pm-roy-bit", name: "ביט רועי", color: "#2dd4bf", iconKey: "smartphone" },
];

export const MOCK_DESTINATION_ACCOUNTS: PaymentMethod[] = [
  { id: "acc-leumi", name: "בנק לאומי", color: "#2563eb", iconKey: "landmark" },
  { id: "acc-joint", name: "חשבון משותף", color: "#8b5cf6", iconKey: "wallet" },
  { id: "acc-cash", name: "מזומן", color: "#14b8a6", iconKey: "banknote" },
];

export type Expense = {
  id: string;
  /** ISO YYYY-MM-DD */
  date: string;
  amount: number;
  currency: string;
  categoryId: string;
  paymentMethodId: string;
  note: string;
  type: EntryType;
  installments: number;
  installmentIndex: number;
  recurringMonthly: boolean;
  /** Bank reconciliation — optional; omitted means not verified. */
  isVerified?: boolean;
};

/** נתוני הדגמה — מפוזרים לפי חודשים לסינון בלוח הבקרה */
export const MOCK_EXPENSES: Expense[] = [
  // מרץ 2026 — סכומים מצטברים דומים לדמו הקודם
  {
    id: "seed-m3-1",
    date: "2026-03-02",
    amount: 420,
    currency: "ILS",
    categoryId: "cat-groceries",
    paymentMethodId: "pm-roy-credit",
    note: "סופר יוחננוף",
    type: "expense",
    installments: 1,
    installmentIndex: 1,
    recurringMonthly: false,
  },
  {
    id: "seed-m3-2",
    date: "2026-03-08",
    amount: 820,
    currency: "ILS",
    categoryId: "cat-groceries",
    paymentMethodId: "pm-noy-credit",
    note: "קניות שבועיות",
    type: "expense",
    installments: 1,
    installmentIndex: 1,
    recurringMonthly: false,
  },
  {
    id: "seed-m3-3",
    date: "2026-03-05",
    amount: 180,
    currency: "ILS",
    categoryId: "cat-transport",
    paymentMethodId: "pm-roy-bit",
    note: "רב־קו",
    type: "expense",
    installments: 1,
    installmentIndex: 1,
    recurringMonthly: false,
  },
  {
    id: "seed-m3-4",
    date: "2026-03-11",
    amount: 200,
    currency: "ILS",
    categoryId: "cat-transport",
    paymentMethodId: "pm-roy-credit",
    note: "דלק",
    type: "expense",
    installments: 1,
    installmentIndex: 1,
    recurringMonthly: false,
  },
  {
    id: "seed-m3-5",
    date: "2026-03-06",
    amount: 240,
    currency: "ILS",
    categoryId: "cat-dining",
    paymentMethodId: "pm-noy-credit",
    note: "ארוחת צהריים",
    type: "expense",
    installments: 1,
    installmentIndex: 1,
    recurringMonthly: false,
  },
  {
    id: "seed-m3-6",
    date: "2026-03-14",
    amount: 380,
    currency: "ILS",
    categoryId: "cat-dining",
    paymentMethodId: "pm-roy-credit",
    note: "מסעדה",
    type: "expense",
    installments: 1,
    installmentIndex: 1,
    recurringMonthly: false,
  },
  {
    id: "seed-m3-7",
    date: "2026-03-01",
    amount: 260,
    currency: "ILS",
    categoryId: "cat-utilities",
    paymentMethodId: "pm-roy-credit",
    note: "חשמל",
    type: "expense",
    installments: 1,
    installmentIndex: 1,
    recurringMonthly: false,
  },
  {
    id: "seed-m3-8",
    date: "2026-03-12",
    amount: 250,
    currency: "ILS",
    categoryId: "cat-utilities",
    paymentMethodId: "pm-noy-credit",
    note: "סלולר",
    type: "expense",
    installments: 1,
    installmentIndex: 1,
    recurringMonthly: false,
  },
  {
    id: "seed-m3-9",
    date: "2026-03-09",
    amount: 120,
    currency: "ILS",
    categoryId: "cat-health",
    paymentMethodId: "pm-roy-credit",
    note: "בית מרקחת",
    type: "expense",
    installments: 1,
    installmentIndex: 1,
    recurringMonthly: false,
  },
  {
    id: "seed-m3-10",
    date: "2026-03-15",
    amount: 90,
    currency: "ILS",
    categoryId: "cat-health",
    paymentMethodId: "pm-noy-credit",
    note: "השתלמות רופא",
    type: "expense",
    installments: 1,
    installmentIndex: 1,
    recurringMonthly: false,
  },
  {
    id: "seed-m3-11",
    date: "2026-03-04",
    amount: 95,
    currency: "ILS",
    categoryId: "cat-entertainment",
    paymentMethodId: "pm-roy-bit",
    note: "סטרימינג",
    type: "expense",
    installments: 1,
    installmentIndex: 1,
    recurringMonthly: false,
  },
  {
    id: "seed-m3-12",
    date: "2026-03-16",
    amount: 80,
    currency: "ILS",
    categoryId: "cat-entertainment",
    paymentMethodId: "pm-roy-credit",
    note: "קולנוע",
    type: "expense",
    installments: 1,
    installmentIndex: 1,
    recurringMonthly: false,
  },
  // פברואר 2026 — סכומים שונים לסימולציה
  {
    id: "seed-f2-1",
    date: "2026-02-10",
    amount: 890,
    currency: "ILS",
    categoryId: "cat-groceries",
    paymentMethodId: "pm-noy-credit",
    note: "",
    type: "expense",
    installments: 1,
    installmentIndex: 1,
    recurringMonthly: false,
  },
  {
    id: "seed-f2-2",
    date: "2026-02-18",
    amount: 310,
    currency: "ILS",
    categoryId: "cat-transport",
    paymentMethodId: "pm-roy-credit",
    note: "רכבת",
    type: "expense",
    installments: 1,
    installmentIndex: 1,
    recurringMonthly: false,
  },
  {
    id: "seed-f2-3",
    date: "2026-02-22",
    amount: 410,
    currency: "ILS",
    categoryId: "cat-dining",
    paymentMethodId: "pm-roy-bit",
    note: "",
    type: "expense",
    installments: 1,
    installmentIndex: 1,
    recurringMonthly: false,
  },
  {
    id: "seed-f2-4",
    date: "2026-02-05",
    amount: 600,
    currency: "ILS",
    categoryId: "cat-utilities",
    paymentMethodId: "pm-roy-credit",
    note: "ארנונה חלקית",
    type: "expense",
    installments: 1,
    installmentIndex: 1,
    recurringMonthly: false,
  },
  {
    id: "seed-m3-income-1",
    date: "2026-03-01",
    amount: 14500,
    currency: "ILS",
    categoryId: "inc-salary",
    paymentMethodId: "acc-leumi",
    note: "משכורת חודשית",
    type: "income",
    installments: 1,
    installmentIndex: 1,
    recurringMonthly: true,
  },
  {
    id: "seed-m3-income-2",
    date: "2026-03-10",
    amount: 2200,
    currency: "ILS",
    categoryId: "inc-training",
    paymentMethodId: "acc-joint",
    note: "אימונים פרטיים",
    type: "income",
    installments: 1,
    installmentIndex: 1,
    recurringMonthly: false,
  },
  {
    id: "seed-m2-income-1",
    date: "2026-02-01",
    amount: 14200,
    currency: "ILS",
    categoryId: "inc-salary",
    paymentMethodId: "acc-leumi",
    note: "משכורת",
    type: "income",
    installments: 1,
    installmentIndex: 1,
    recurringMonthly: true,
  },
];

/** תקציב חודשי ברירת מחדל לכל קטגוריה (ש״ח) */
export const DEFAULT_CATEGORY_BUDGETS: Record<string, number> = {
  "cat-groceries": 1000,
  "cat-transport": 450,
  "cat-dining": 500,
  "cat-utilities": 600,
  "cat-health": 400,
  "cat-entertainment": 300,
};

/** מזהים מובנים לסוגי נכס (ניתן להוסיף סוגים מותאמים בנפרד) */
export const BUILTIN_ASSET_TYPE_IDS = ["liquid", "portfolio", "pension"] as const;
export type BuiltinAssetTypeId = (typeof BUILTIN_ASSET_TYPE_IDS)[number];
export type AssetTypeId = string;

/** שם נכס שמור לפי סוג — להצעה בטופס */
export type AssetNamePreset = {
  id: string;
  type: AssetTypeId;
  name: string;
};

export type AssetAccount = {
  id: string;
  type: AssetTypeId;
  name: string;
  balance: number;
  /** קוד מטבע (ILS / USD / EUR / מותאם אישית) */
  currency: CurrencyCode;
  /** Accent color for UI (hex). */
  color?: string;
};

export const MOCK_ASSET_ACCOUNTS: AssetAccount[] = [
  { id: "asset-leumi", type: "liquid", name: "עו\"ש לאומי", balance: 42150, currency: "ILS", color: "#22c55e" },
  { id: "asset-cash", type: "liquid", name: "מזומן", balance: 2100, currency: "ILS", color: "#22c55e" },
  { id: "asset-portfolio", type: "portfolio", name: "תיק השקעות", balance: 164300, currency: "ILS", color: "#3b82f6" },
  { id: "asset-pension", type: "pension", name: "פנסיה", balance: 248900, currency: "ILS", color: "#a855f7" },
  { id: "asset-study", type: "pension", name: "קרן השתלמות", balance: 72300, currency: "ILS", color: "#a855f7" },
];

export type AssetSnapshot = {
  ym: `${number}-${number}`;
  accounts: AssetAccount[];
};

export const MOCK_ASSET_SNAPSHOTS: AssetSnapshot[] = [
  {
    ym: "2026-01",
    accounts: [
      { id: "asset-leumi", type: "liquid", name: "עו\"ש לאומי", balance: 33200, currency: "ILS" },
      { id: "asset-cash", type: "liquid", name: "מזומן", balance: 1800, currency: "ILS" },
      { id: "asset-portfolio", type: "portfolio", name: "תיק השקעות", balance: 151900, currency: "ILS" },
      { id: "asset-pension", type: "pension", name: "פנסיה", balance: 240500, currency: "ILS" },
      { id: "asset-study", type: "pension", name: "קרן השתלמות", balance: 69400, currency: "ILS" },
    ],
  },
  {
    ym: "2026-02",
    accounts: [
      { id: "asset-leumi", type: "liquid", name: "עו\"ש לאומי", balance: 36700, currency: "ILS" },
      { id: "asset-cash", type: "liquid", name: "מזומן", balance: 2000, currency: "ILS" },
      { id: "asset-portfolio", type: "portfolio", name: "תיק השקעות", balance: 158700, currency: "ILS" },
      { id: "asset-pension", type: "pension", name: "פנסיה", balance: 244800, currency: "ILS" },
      { id: "asset-study", type: "pension", name: "קרן השתלמות", balance: 71000, currency: "ILS" },
    ],
  },
  {
    ym: "2026-03",
    accounts: [...MOCK_ASSET_ACCOUNTS],
  },
];
