/** Max receipt images per transaction (DB + UI). */
export const MAX_RECEIPT_IMAGES = 3;

export function capReceiptUrls(urls: string[] | null | undefined): string[] {
  if (!urls?.length) return [];
  return urls
    .map((u) => (typeof u === "string" ? u.trim() : ""))
    .filter(Boolean)
    .slice(0, MAX_RECEIPT_IMAGES);
}
