/** Flexible column resolution for Hebrew / English headers. */
function normKey(k: string): string {
  return k.trim().toLowerCase().normalize("NFC");
}

function findColumn(
  keys: string[],
  matchers: ((k: string) => boolean)[],
): string | null {
  for (const key of keys) {
    const n = normKey(key);
    for (const m of matchers) {
      if (m(n)) return key;
    }
  }
  return null;
}

const has =
  (...subs: string[]) =>
  (n: string) =>
    subs.every((s) => n.includes(s));

export function resolveAssetColumns(keys: string[]): {
  date: string | null;
  amount: string | null;
  name: string | null;
  type: string | null;
  currency: string | null;
} {
  const date = findColumn(keys, [
    has("תאריך"),
    (n) => n === "date" || n.startsWith("date "),
    (n) => n.includes("transaction date"),
  ]);
  const amount = findColumn(keys, [
    has("סכום"),
    (n) => n === "amount" || n.startsWith("amount"),
    has("יתרה"),
    (n) => n.includes("balance"),
  ]);
  const name = findColumn(keys, [
    has("שם"),
    (n) => n === "name" || n.startsWith("name "),
    (n) => n.includes("account") && !n.includes("type"),
    has("חשבון"),
  ]);
  const type = findColumn(keys, [
    (n) => n.includes("סוג") && !n.includes("מטבע"),
    (n) => (n.includes("type") || n.includes("asset type")) && !n.includes("entry"),
    (n) => n.includes("קטגוריה") && n.includes("נכס"),
  ]);
  const currency = findColumn(keys, [has("מטבע"), (n) => n.includes("currency")]);
  return { date, amount, name, type, currency };
}

export function resolveIncomeColumns(keys: string[]): {
  date: string | null;
  amount: string | null;
  currency: string | null;
  category: string | null;
  destination: string | null;
  note: string | null;
} {
  const date = findColumn(keys, [
    has("תאריך"),
    (n) => n === "date" || n.startsWith("date "),
  ]);
  const amount = findColumn(keys, [has("סכום"), (n) => n.includes("amount")]);
  const currency = findColumn(keys, [has("מטבע"), (n) => n.includes("currency")]);
  const category = findColumn(keys, [
    has("קטגוריה"),
    (n) => n.includes("category"),
    has("מקור הכנסה"),
    (n) => n.includes("income") && n.includes("source"),
  ]);
  const destination = findColumn(keys, [
    (n) => n.includes("יעד") || n.includes("destination"),
    (n) => n.includes("חשבון") && (n.includes("יעד") || n.includes("הפקדה")),
    has("אמצעי"),
    has("אופן", "תשלום"),
    (n) => n.includes("payment") && (n.includes("type") || n.includes("mode")),
    (n) => n.includes("payment") && (n.includes("account") || n.includes("method")),
    has("שיטת"),
  ]);
  const note = findColumn(keys, [
    has("הערות"),
    has("הערה"),
    (n) => n === "note" || n.includes("notes"),
  ]);
  return { date, amount, currency, category, destination, note };
}

export function missingAssetColumns(c: ReturnType<typeof resolveAssetColumns>): string[] {
  const m: string[] = [];
  if (!c.date) m.push("תאריך / Date");
  if (!c.amount) m.push("סכום / Amount");
  if (!c.name) m.push("שם / Name");
  if (!c.type) m.push("סוג / Type");
  return m;
}

export function missingIncomeColumns(c: ReturnType<typeof resolveIncomeColumns>): string[] {
  const m: string[] = [];
  if (!c.date) m.push("תאריך / Date");
  if (!c.amount) m.push("סכום / Amount");
  if (!c.currency) m.push("מטבע / Currency");
  if (!c.category) m.push("קטגוריה / Category");
  if (!c.destination) m.push("חשבון יעד / Destination");
  return m;
}
