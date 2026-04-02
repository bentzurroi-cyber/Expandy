import { createClient } from "@supabase/supabase-js";

const FALLBACK_SUPABASE_URL = "https://jusmoqefhkmsafuzicpo.supabase.co";
const FALLBACK_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_iaGYh6kso5sFVk9xWNLvqA_e3_rB4Mi";
const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ||
  FALLBACK_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ||
  FALLBACK_SUPABASE_PUBLISHABLE_KEY;

if (
  !(import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
  !(import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)
) {
  console.warn(
    "[Supabase] Using fallback credentials. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for production consistency.",
  );
}

function createBrowserSupabaseClient() {
  console.log("Supabase URL:", import.meta.env.VITE_SUPABASE_URL);
  console.log("Supabase Key:", import.meta.env.VITE_SUPABASE_ANON_KEY);
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

export const supabase = createBrowserSupabaseClient();

export type ProfileRow = {
  id: string;
  email: string;
  household_id: string;
  is_admin: boolean;
  /** Preferred payment method for new expenses; empty = first in list. */
  default_payment_method_id: string;
  /** Preferred destination account for new income; empty = first in list. */
  default_destination_account_id: string;
  /** Number of quick categories shown in expense form (1-8). */
  category_display_limit: number;
  /**
   * Asset type id to omit from headline net worth (e.g. `pension`); empty = all types.
   */
  /**
   * Optional for backwards compatibility (older DB schema might not have this column yet).
   * Empty/missing = include all asset types.
   */
  assets_total_exclude_type_id?: string;
};
