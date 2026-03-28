/** UUID hex pattern (matches typical v4 and DB-stored ids), case-insensitive. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isStandardUuid(id: string): boolean {
  return typeof id === "string" && UUID_RE.test(id.trim());
}

/** Virtual id for a projected recurring instance: `rec|<templateUuid>|<YYYY-MM>`. */
export function parseProjectedRecurringId(
  id: string,
): { templateId: string; ym: `${number}-${number}` } | null {
  if (!id.startsWith("rec|")) return null;
  const parts = id.split("|");
  if (parts.length !== 3) return null;
  const templateId = parts[1] ?? "";
  const ym = parts[2] ?? "";
  if (!isStandardUuid(templateId) || !/^\d{4}-\d{2}$/.test(ym)) return null;
  return { templateId, ym: ym as `${number}-${number}` };
}

/**
 * Legacy client-generated installment row id: `<uuid>-installment-<n>`.
 * Supabase UUID columns cannot store this string as primary key.
 */
export function parseLegacyInstallmentCompositeId(
  id: string,
): { baseId: string; index: number } | null {
  const marker = "-installment-";
  const idx = id.lastIndexOf(marker);
  if (idx <= 0) return null;
  const baseId = id.slice(0, idx);
  const rest = id.slice(idx + marker.length);
  const index = Number(rest);
  if (!Number.isInteger(index) || index < 1) return null;
  if (!isStandardUuid(baseId)) return null;
  return { baseId, index };
}
