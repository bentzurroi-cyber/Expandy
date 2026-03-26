export function parseNumericInput(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function formatNumericInput(raw: string): string {
  const cleaned = raw.replace(/,/g, "").replace(/[^\d.]/g, "");
  if (!cleaned) return "";
  const [intPart, decPart] = cleaned.split(".");
  const intFormatted = (intPart || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (typeof decPart === "string") return `${intFormatted}.${decPart}`;
  return intFormatted;
}

