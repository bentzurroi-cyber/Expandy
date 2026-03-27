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

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type ProfileRow = {
  id: string;
  email: string;
  household_id: string;
  is_admin: boolean;
};
