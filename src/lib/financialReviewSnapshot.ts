import { supabase } from "@/lib/supabase";
import type { YearMonth } from "@/lib/month";

export const FINANCIAL_REVIEW_SNAPSHOT_VERSION = 1 as const;
export const MONTHLY_SNAPSHOT_VERSION = 2 as const;

export type SnapshotAsset = {
  id: string;
  name: string;
  type: string;
  balance: number;
  currency: string;
};

export type FinancialReviewSnapshotPayloadV1 = {
  version: typeof FINANCIAL_REVIEW_SNAPSHOT_VERSION;
  reviewMonth: YearMonth;
  closedAt: string;
  assets: SnapshotAsset[];
  incomeIls: number;
  expenseIls: number;
  surplusIls: number;
  adviceHe: string;
  adviceEn: string;
};

export type MonthlySnapshotPayloadV2 = {
  version: typeof MONTHLY_SNAPSHOT_VERSION;
  reviewMonth: YearMonth;
  closedAt: string;
  assets: SnapshotAsset[];
  incomeIls: number;
  expenseIls: number;
  surplusIls: number;
  adviceHe: string;
  adviceEn: string;
  topExpenseCategories: Array<{ categoryId: string; name: string; amountIls: number }>;
  /** Sum of income rows in the reviewed month (before manual override). */
  incomeFromTransactionsIls?: number;
  /** When set, user overrode total income for this close (e.g. salary logged next month). */
  incomeManualOverrideIls?: number | null;
  savingsGoalsStatus: Array<{
    id: string;
    name: string;
    monthlyContribution: number;
    monthlyCurrent: number;
    targetAmount: number;
    currentAmount: number;
    isInvestmentPortfolio: boolean;
  }>;
};

export type MonthlySnapshotPayload = FinancialReviewSnapshotPayloadV1 | MonthlySnapshotPayloadV2;

export function isMonthlySnapshotV2(
  p: MonthlySnapshotPayload | null | undefined,
): p is MonthlySnapshotPayloadV2 {
  return p != null && p.version === MONTHLY_SNAPSHOT_VERSION;
}

export type FinancialReviewSnapshotRow = {
  id: string;
  household_id: string;
  review_month: YearMonth;
  payload: MonthlySnapshotPayload;
  created_at: string;
};

export async function fetchFinancialReviewSnapshots(
  householdId: string,
): Promise<FinancialReviewSnapshotRow[]> {
  const { data, error } = await supabase
    .from("monthly_snapshots")
    .select("id, household_id, review_month, payload, created_at")
    .eq("household_id", householdId)
    .order("review_month", { ascending: false });
  if (error) {
    console.error("[monthlySnapshot] list failed", error);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: String(r.id),
    household_id: String(r.household_id),
    review_month: String(r.review_month) as YearMonth,
    payload: normalizePayload(r.payload),
    created_at: String(r.created_at),
  }));
}

function normalizePayload(raw: unknown): MonthlySnapshotPayload {
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const v = o.version;
    if (v === MONTHLY_SNAPSHOT_VERSION) return raw as MonthlySnapshotPayloadV2;
    if (v === FINANCIAL_REVIEW_SNAPSHOT_VERSION) return raw as FinancialReviewSnapshotPayloadV1;
    return { ...o, version: FINANCIAL_REVIEW_SNAPSHOT_VERSION } as FinancialReviewSnapshotPayloadV1;
  }
  return raw as FinancialReviewSnapshotPayloadV1;
}

export async function upsertMonthlySnapshot(
  householdId: string,
  userId: string,
  payload: MonthlySnapshotPayloadV2,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("monthly_snapshots").upsert(
    {
      household_id: householdId,
      review_month: payload.reviewMonth,
      payload: payload as unknown as Record<string, unknown>,
      created_by: userId,
    },
    { onConflict: "household_id,review_month" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** @deprecated use upsertMonthlySnapshot */
export const upsertFinancialReviewSnapshot = upsertMonthlySnapshot;
