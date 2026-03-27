import { supabase } from "@/lib/supabase";

const CODE_LENGTH = 6;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeHouseholdCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH);
}

export function isValidHouseholdCode(input: string): boolean {
  return /^[A-Z0-9]{6}$/.test(normalizeHouseholdCode(input));
}

function randomHouseholdCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    const idx = Math.floor(Math.random() * CODE_ALPHABET.length);
    code += CODE_ALPHABET[idx];
  }
  return code;
}

export async function ensureHouseholdExists(
  codeInput: string,
  createdBy?: string | null,
): Promise<string> {
  const code = normalizeHouseholdCode(codeInput);
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    throw new Error("Invalid household code");
  }
  const { error } = await supabase.from("households").upsert(
    {
      code,
      created_by: createdBy ?? null,
    },
    { onConflict: "code" },
  );
  if (error) throw new Error(error.message);
  return code;
}

export async function doesHouseholdCodeExist(codeInput: string): Promise<boolean> {
  const code = normalizeHouseholdCode(codeInput);
  if (!/^[A-Z0-9]{6}$/.test(code)) return false;
  const { data, error } = await supabase
    .from("households")
    .select("code")
    .eq("code", code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data?.code);
}

/** Inserts a new row into `households` and returns the new code. Call this before creating a profile row. */
export async function generateUniqueHouseholdCode(createdBy?: string | null): Promise<string> {
  for (let i = 0; i < 40; i += 1) {
    const code = randomHouseholdCode();
    const { error } = await supabase.from("households").insert({
      code,
      created_by: createdBy ?? null,
    });
    if (!error) return code;
    if (error.code === "23505") continue;
    throw new Error(error.message);
  }
  throw new Error("Could not allocate a unique household code");
}
