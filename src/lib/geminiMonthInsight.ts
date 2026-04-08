/**
 * Future: send sanitized month aggregates to Gemini for a personalized minimalist tip.
 * Do not call the API until keys and privacy review are in place.
 */

import type { YearMonth } from "@/lib/month";

/** Payload you can POST to your edge function → Gemini later. */
export type GeminiMonthInsightPayload = {
  month: YearMonth;
  locale: "he" | "en";
  /** Optional user-stated preferences (minimalism, risk, etc.) — extend when profile supports it. */
  userValuesNote?: string;
  totals: {
    incomeIls: number;
    expenseIls: number;
    surplusIls: number;
  };
  /** Category-level rollups only — no free-text memos from transactions. */
  expenseByCategory?: { categoryId: string; amountIls: number }[];
  savingsGoalsSummary?: {
    count: number;
    totalCurrentIls: number;
    totalTargetIls: number;
  };
};

export type GeminiMonthInsightResult = {
  text: string;
  model?: string;
};

/**
 * Placeholder: returns null. Replace with fetch to Edge Function that calls Gemini.
 *
 * Example (later):
 * const res = await fetch("/api/gemini-month-insight", {
 *   method: "POST",
 *   headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
 *   body: JSON.stringify(payload),
 * });
 */
export async function fetchGeminiMonthInsight(
  _payload: GeminiMonthInsightPayload,
): Promise<GeminiMonthInsightResult | null> {
  void _payload;
  return null;
}

export function buildGeminiMonthPayload(input: {
  month: YearMonth;
  locale: "he" | "en";
  incomeIls: number;
  expenseIls: number;
  userValuesNote?: string;
  expenseByCategory?: { categoryId: string; amountIls: number }[];
  goalsCount: number;
  goalsCurrentIls: number;
  goalsTargetIls: number;
}): GeminiMonthInsightPayload {
  const surplusIls = Math.round((input.incomeIls - input.expenseIls) * 100) / 100;
  return {
    month: input.month,
    locale: input.locale,
    userValuesNote: input.userValuesNote,
    totals: {
      incomeIls: input.incomeIls,
      expenseIls: input.expenseIls,
      surplusIls,
    },
    expenseByCategory: input.expenseByCategory,
    savingsGoalsSummary: {
      count: input.goalsCount,
      totalCurrentIls: input.goalsCurrentIls,
      totalTargetIls: input.goalsTargetIls,
    },
  };
}
