/** Trim, Unicode NFC, lowercase — for matching category/method names (CSV + storage). */
export function normalizeOptionName(name: string): string {
  return name.trim().normalize("NFC").toLocaleLowerCase("und");
}
