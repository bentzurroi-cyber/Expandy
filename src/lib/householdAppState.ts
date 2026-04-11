import { supabase } from "@/lib/supabase";

/** Keys stored in `public.profiles.app_state` (jsonb) for cloud UX sync. */
export const APP_STATE_KEYS = {
  budgetsByMonth: "budgets_by_month",
  deletedBuiltinExpenseCategoryIds: "deleted_builtin_expense_category_ids",
  deletedBuiltinIncomeCategoryIds: "deleted_builtin_income_category_ids",
  /**
   * Per-user Data Entry (הזנה) layout: drag order of category tiles, scoped by household.
   * Value: Record<householdCode, { expense: string[]; income: string[] }>
   * (category ids only; no DB changes on shared categories).
   */
  dataEntryCategoryLayoutByHousehold: "data_entry_category_layout_by_hh",
} as const;

export type HouseholdAppState = Record<string, unknown>;

function parseAppState(raw: unknown): HouseholdAppState {
  return raw != null && typeof raw === "object" && !Array.isArray(raw)
    ? { ...(raw as HouseholdAppState) }
    : {};
}

/** Loads merged JSON app prefs for the signed-in user (`profiles.app_state`). */
export async function fetchProfileAppState(userId: string): Promise<HouseholdAppState> {
  const uid = userId?.trim();
  if (!uid) return {};
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("app_state")
      .eq("id", uid)
      .maybeSingle();
    if (error) {
      return {};
    }
    if (!data) return {};
    return parseAppState((data as { app_state?: unknown }).app_state);
  } catch {
    return {};
  }
}

/**
 * Shallow-merge `patch` into `profiles.app_state` for this user (read–modify–write).
 */
export async function patchProfileAppState(
  userId: string,
  patch: HouseholdAppState,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const uid = userId?.trim();
  if (!uid) return { ok: false, error: "missing user" };
  try {
    const { data: row, error: selErr } = await supabase
      .from("profiles")
      .select("app_state")
      .eq("id", uid)
      .maybeSingle();
    if (selErr) return { ok: false, error: selErr.message };

    const prev = parseAppState((row as { app_state?: unknown } | null)?.app_state);
    const next = { ...prev, ...patch };

    const { error } = await supabase.from("profiles").update({ app_state: next }).eq("id", uid);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "app_state save failed",
    };
  }
}
