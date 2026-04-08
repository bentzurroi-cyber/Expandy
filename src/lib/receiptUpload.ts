import { supabase } from "@/lib/supabase";

/**
 * Uploads a receipt image to the `receipts` Storage bucket.
 *
 * Supabase setup (Dashboard → Storage):
 * 1. Create a bucket named `receipts`.
 * 2. Add RLS policies so authenticated users can upload/read objects under
 *    a path prefix that includes their `household_id` (and optionally `user_id`),
 *    e.g. `{household_id}/{user_id}/{filename}`.
 * 3. If the bucket is private, use signed URLs for display instead of `getPublicUrl`.
 */
export async function uploadReceiptImage(params: {
  householdId: string;
  userId: string;
  expenseId: string;
  /** Slot 0–2 for up to 3 images per expense (unique storage path). */
  slotIndex?: number;
  file: File;
}): Promise<{ url: string } | { error: string }> {
  const { householdId, userId, expenseId, file } = params;
  const slot = typeof params.slotIndex === "number" ? Math.max(0, Math.min(2, params.slotIndex)) : 0;
  const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(0, 80);
  const ext =
    safeName.includes(".") && safeName.length > 1
      ? safeName.slice(safeName.lastIndexOf("."))
      : ".jpg";
  const path = `${householdId}/${userId}/${expenseId}-${slot}${ext}`;
  const { error: upErr } = await supabase.storage
    .from("receipts")
    .upload(path, file, {
      upsert: true,
      contentType: file.type || "image/jpeg",
    });
  if (upErr) {
    return { error: upErr.message };
  }
  const { data } = supabase.storage.from("receipts").getPublicUrl(path);
  if (!data?.publicUrl) {
    return { error: "Could not resolve receipt URL" };
  }
  return { url: data.publicUrl };
}

/** Upload up to 3 images in parallel; returns public URLs in the same order. */
export async function uploadReceiptImagesParallel(params: {
  householdId: string;
  userId: string;
  expenseId: string;
  files: File[];
}): Promise<{ urls: string[] } | { error: string }> {
  const { householdId, userId, expenseId, files } = params;
  const list = files.slice(0, 3);
  if (!list.length) return { urls: [] };
  const results = await Promise.all(
    list.map((file, i) =>
      uploadReceiptImage({ householdId, userId, expenseId, file, slotIndex: i }),
    ),
  );
  const urls: string[] = [];
  for (const r of results) {
    if ("error" in r) return { error: r.error };
    const u = r.url.trim();
    if (!u) return { error: "Could not resolve receipt URL" };
    urls.push(u);
  }
  return { urls };
}

const PUBLIC_RECEIPTS_MARKER = "/object/public/receipts/";

/** Resolves storage object path (within the `receipts` bucket) from a public object URL. */
export function receiptsBucketPathFromPublicUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const i = u.pathname.indexOf(PUBLIC_RECEIPTS_MARKER);
    if (i === -1) return null;
    return decodeURIComponent(u.pathname.slice(i + PUBLIC_RECEIPTS_MARKER.length));
  } catch {
    return null;
  }
}

/** Deletes one receipt object when its URL points at our Supabase `receipts` bucket. */
export async function deleteReceiptObjectByPublicUrl(
  publicUrl: string,
): Promise<{ error?: string }> {
  const path = receiptsBucketPathFromPublicUrl(publicUrl);
  if (!path) return {};
  const { error } = await supabase.storage.from("receipts").remove([path]);
  if (error) return { error: error.message };
  return {};
}

/** Deletes several distinct storage paths (deduped). */
export async function deleteReceiptObjectsByPublicUrls(urls: string[]): Promise<{ error?: string }> {
  const paths = [
    ...new Set(
      urls.map((u) => receiptsBucketPathFromPublicUrl(u)).filter((p): p is string => Boolean(p)),
    ),
  ];
  if (!paths.length) return {};
  const { error } = await supabase.storage.from("receipts").remove(paths);
  if (error) return { error: error.message };
  return {};
}
