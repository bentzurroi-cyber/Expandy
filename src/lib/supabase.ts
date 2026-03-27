import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://jusmoqefhkmsafuzicpo.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_iaGYh6kso5sFVk9xWNLvqA_e3_rB4Mi";

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
