/** Stored in `savings_goals.holding_asset_type` — matches `assets.type` / household asset type id. */
const MAX_LEN = 128;

export function normalizeHoldingAssetType(raw: string | null | undefined): string {
  const t = typeof raw === "string" ? raw.trim().slice(0, MAX_LEN) : "";
  return t;
}
