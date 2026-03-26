import type { Category, Expense, PaymentMethod } from "@/data/mock";
import { normalizeOptionName } from "@/lib/normalize";

export function dedupeExpenseRows(expenses: Expense[]): Expense[] {
  const seen = new Set<string>();
  const out: Expense[] = [];
  for (const e of expenses) {
    if (!e || typeof e.id !== "string") continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

export function dedupeCategoriesByName(categories: Category[]): Category[] {
  const byNorm = new Map<string, Category>();
  for (const c of categories) {
    const k = normalizeOptionName(c.name);
    if (!byNorm.has(k)) byNorm.set(k, c);
  }
  return [...byNorm.values()];
}

export function dedupePaymentMethodsByName(
  methods: PaymentMethod[],
): PaymentMethod[] {
  const byNorm = new Map<string, PaymentMethod>();
  for (const p of methods) {
    const k = normalizeOptionName(p.name);
    if (!byNorm.has(k)) byNorm.set(k, p);
  }
  return [...byNorm.values()];
}
