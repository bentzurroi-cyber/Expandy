import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, type ProfileRow } from "@/lib/supabase";
import {
  doesHouseholdCodeExist,
  ensureHouseholdExists,
  generateUniqueHouseholdCode,
  isValidHouseholdCode,
  normalizeHouseholdCode,
} from "@/lib/household";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  profile: ProfileRow | null;
  profileError: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (
    email: string,
    password: string,
    householdId: string,
    isAdmin?: boolean,
  ) => Promise<string | null>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  retryBootstrap: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function clampCategoryDisplayLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 8;
  return Math.max(1, Math.min(8, Math.floor(parsed)));
}

function clampReviewDay(value: unknown): number | null {
  if (value == null) return null;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1 || n > 31) return null;
  return n;
}

function normalizeProfileRow(row: ProfileRow): ProfileRow {
  const raw = (row as unknown as Record<string, unknown>)
    .assets_total_exclude_type_id;
  const ex = typeof raw === "string" ? raw.trim() : "";
  return {
    ...row,
    category_display_limit: clampCategoryDisplayLimit(row.category_display_limit),
    assets_total_exclude_type_id: ex,
    review_day: clampReviewDay((row as unknown as Record<string, unknown>).review_day),
  };
}

async function withTimeout<T>(run: () => Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    run(),
    new Promise<T>((_resolve, reject) => {
      window.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

type EnsureProfileOptions = {
  /**
   * If set and the code exists in `households`, submit a pending join request (requires approval).
   * The profile always keeps a dedicated household until a member approves the request.
   */
  joinHouseholdCode?: string;
  isAdmin?: boolean;
};

async function resolveWantsJoin(joinHouseholdCode: string | undefined): Promise<{
  wantsJoin: boolean;
  normalizedJoin: string;
}> {
  const normalizedJoin = normalizeHouseholdCode(joinHouseholdCode ?? "");
  if (!isValidHouseholdCode(normalizedJoin)) {
    return { wantsJoin: false, normalizedJoin };
  }
  const exists = await doesHouseholdCodeExist(normalizedJoin).catch(() => false);
  return { wantsJoin: exists, normalizedJoin };
}

async function ensureProfile(user: User, options?: EnsureProfileOptions) {
  const isAdmin = options?.isAdmin ?? false;
  const email = user.email?.trim().toLowerCase() ?? "";
  if (!email) return;

  const { wantsJoin, normalizedJoin } = await resolveWantsJoin(options?.joinHouseholdCode);

  const { data: existing, error } = await supabase
    .from("profiles")
    .select(
      "id, email, household_id, is_admin, default_payment_method_id, default_destination_account_id, category_display_limit",
    )
    .eq("id", user.id)
    .maybeSingle();
  if (error) {
    console.error("[Auth] Profile fetch failed", { userId: user.id, error: error.message });
  }
  if (existing) {
    if (wantsJoin) {
      const current = normalizeHouseholdCode(existing.household_id ?? "");
      if (current !== normalizedJoin) {
        await ensureHouseholdExists(normalizedJoin, user.id);
        const { error: jrErr } = await supabase.rpc("submit_household_join_request", {
          p_household_code: normalizedJoin,
          p_import_previous_data: false,
        });
        if (jrErr) {
          console.error("[Auth] submit_household_join_request failed", jrErr);
        }
      }
      return;
    }
    if (!isValidHouseholdCode(normalizeHouseholdCode(existing.household_id ?? ""))) {
      const assigned = await generateUniqueHouseholdCode(user.id);
      await ensureHouseholdExists(assigned, user.id);
      await supabase.from("profiles").update({ household_id: assigned }).eq("id", user.id);
    }
    return;
  }
  const resolvedHousehold = await generateUniqueHouseholdCode(user.id);
  if (wantsJoin) {
    await ensureHouseholdExists(normalizedJoin, user.id);
  }

  const { error: upsertError } = await supabase.from("profiles").upsert({
    id: user.id,
    email,
    household_id: resolvedHousehold,
    is_admin: isAdmin,
  });
  if (upsertError) {
    console.error("[Auth] Profile upsert failed", { userId: user.id, error: upsertError.message });
  }

  if (wantsJoin && !upsertError) {
    const { error: jrErr } = await supabase.rpc("submit_household_join_request", {
      p_household_code: normalizedJoin,
      p_import_previous_data: false,
    });
    if (jrErr) {
      console.error("[Auth] submit_household_join_request after signup failed", jrErr);
    }
  }
}

async function ensureValidHouseholdForProfile(
  user: User,
  profile: ProfileRow | null,
): Promise<ProfileRow | null> {
  if (!profile) {
    const assigned = await generateUniqueHouseholdCode(user.id);
    await ensureHouseholdExists(assigned, user.id);
    const payload: ProfileRow = {
      id: user.id,
      email: user.email?.trim().toLowerCase() ?? "",
      household_id: assigned,
      is_admin: false,
      default_payment_method_id: "",
      default_destination_account_id: "",
      category_display_limit: 8,
      review_day: null,
    };
    const { data, error } = await supabase
      .from("profiles")
      .upsert(payload)
      .select(
        "id, email, household_id, is_admin, default_payment_method_id, default_destination_account_id, category_display_limit",
      )
      .maybeSingle();
    if (error) {
      console.error("[Auth] ensureValidHouseholdForProfile upsert failed", error);
      return payload;
    }
    return (data as ProfileRow | null) ?? payload;
  }

  const normalized = normalizeHouseholdCode(profile.household_id ?? "");
  if (isValidHouseholdCode(normalized)) {
    if (profile.household_id !== normalized) {
      return { ...profile, household_id: normalized };
    }
    return profile;
  }

  const assigned = await generateUniqueHouseholdCode(user.id);
  await ensureHouseholdExists(assigned, user.id);
  const { data, error } = await supabase
    .from("profiles")
    .update({ household_id: assigned })
    .eq("id", user.id)
    .select(
      "id, email, household_id, is_admin, default_payment_method_id, default_destination_account_id, category_display_limit",
    )
    .maybeSingle();
  if (error) {
    console.error("[Auth] ensureValidHouseholdForProfile update failed", error);
    return { ...profile, household_id: assigned };
  }
  return (data as ProfileRow | null) ?? { ...profile, household_id: assigned };
}

function guestProfileFor(user: User): ProfileRow {
  return {
    id: user.id,
    email: user.email?.trim().toLowerCase() ?? "",
    household_id: "",
    is_admin: false,
    default_payment_method_id: "",
    default_destination_account_id: "",
    category_display_limit: 8,
    assets_total_exclude_type_id: "",
    review_day: null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfileByUserId = useCallback(async (userId: string) => {
    const profileSelectBundles = [
      "id, email, household_id, is_admin, default_payment_method_id, default_destination_account_id, category_display_limit, assets_total_exclude_type_id, review_day",
      "id, email, household_id, is_admin, default_payment_method_id, default_destination_account_id, category_display_limit, assets_total_exclude_type_id",
      "id, email, household_id, is_admin, default_payment_method_id, default_destination_account_id, category_display_limit, review_day",
      "id, email, household_id, is_admin, default_payment_method_id, default_destination_account_id, category_display_limit",
    ] as const;

    let data: unknown = null;
    let lastError: { message?: string } | null = null;

    for (const cols of profileSelectBundles) {
      const res = await withTimeout(
        async () =>
          await supabase.from("profiles").select(cols).eq("id", userId).maybeSingle(),
        5000,
        "Profile fetch",
      );
      if (!res.error) {
        data = res.data;
        lastError = null;
        break;
      }
      lastError = res.error;
      const msg = String(res.error?.message ?? "").toLowerCase();
      const maybeMissingColumn =
        msg.includes("does not exist") ||
        msg.includes("column") ||
        msg.includes("review_day") ||
        msg.includes("assets_total_exclude_type_id");
      if (!maybeMissingColumn) break;
    }

    if (lastError) {
      console.error("[Auth] Profile fetch failed", { userId, error: lastError.message });
      return null;
    }
    if (!data) return null;
    return normalizeProfileRow(data as ProfileRow);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user?.id) {
      setProfile(null);
      return;
    }
    const next = await fetchProfileByUserId(user.id);
    setProfile(next);
  }, [fetchProfileByUserId, user?.id]);

  const applySession = useCallback(
    async (nextSession: Session | null) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setProfileError(null);
      if (!nextSession?.user) {
        setProfile(null);
        return;
      }
      const u = nextSession.user;
      // Keep an existing profile for this user during token refreshes to avoid
      // transient household_id="" state that can clear synced app data.
      setProfile((prev) => {
        if (prev && prev.id === u.id) return prev;
        return guestProfileFor(u);
      });
      try {
        await ensureProfile(u);
      } catch (err) {
        console.error("[Auth] ensureProfile failed", err);
      }
      try {
        const nextProfile = await fetchProfileByUserId(u.id);
        if (!nextProfile) {
          // Avoid force-creating a new household on transient fetch issues.
          // Keep current profile and retry ensure/fetch once.
          await ensureProfile(u);
          const recovered = await fetchProfileByUserId(u.id);
          const fixed = await ensureValidHouseholdForProfile(
            u,
            recovered ?? null,
          );
          setProfile((prev) => fixed ?? (prev && prev.id === u.id ? prev : guestProfileFor(u)));
          if (!recovered) {
            setProfileError("Profile not found in database");
          }
        } else {
          const fixed = await ensureValidHouseholdForProfile(u, nextProfile);
          setProfile(fixed ?? nextProfile);
          setProfileError(null);
        }
      } catch (err) {
        console.error("[Auth] profile hydrate failed", err);
        setProfile((prev) => (prev && prev.id === u.id ? prev : guestProfileFor(u)));
        setProfileError(
          err instanceof Error
            ? `Profile fetch failed: ${err.message}`
            : "Profile fetch failed",
        );
      }
    },
    [fetchProfileByUserId],
  );

  const retryBootstrap = useCallback(async () => {
    setLoading(true);
    setProfileError(null);
    try {
      const { data } = await supabase.auth.getSession();
      await applySession(data.session);
    } catch (err) {
      console.error("[Auth] retry bootstrap failed", err);
      setProfileError(
        err instanceof Error ? `Retry failed: ${err.message}` : "Retry failed",
      );
    } finally {
      setLoading(false);
    }
  }, [applySession]);

  // SPA "home" after login — no react-router in this project; align URL with main app.
  useEffect(() => {
    if (!session) return;
    if (typeof window === "undefined") return;
    try {
      const path = window.location.pathname || "/";
      if (path !== "/" && path !== "") {
        window.history.replaceState(null, "", "/");
      }
    } catch {
      /* ignore */
    }
  }, [session]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setLoading(true);
      setProfileError(null);
      try {
        const { data } = await supabase.auth.getSession();
        if (!cancelled) await applySession(data.session);
      } catch (err) {
        console.error("[Auth] initial bootstrap failed", err);
        if (!cancelled) {
          setSession(null);
          setUser(null);
          setProfile(null);
          setProfileError(
            err instanceof Error ? `Bootstrap failed: ${err.message}` : "Bootstrap failed",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void bootstrap();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (cancelled) return;
      void applySession(nextSession).catch((err) => {
        console.error("[Auth] onAuthStateChange applySession failed", err);
      });
    });

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible" || cancelled) return;
      void supabase.auth.getSession().then(({ data }) => {
        if (cancelled) return;
        void applySession(data.session).catch((err) =>
          console.error("[Auth] visibility refresh failed", err),
        );
      });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      listener.subscription.unsubscribe();
    };
  }, [applySession]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (!error) {
        const s = data.session ?? (await supabase.auth.getSession()).data.session;
        if (s) {
          try {
            await applySession(s);
          } catch (err) {
            console.error("[Auth] signIn applySession failed", err);
          }
        }
        return null;
      }
      const msg = error.message.toLowerCase();
      if (msg.includes("invalid login credentials")) {
        return "Invalid login credentials. Check email/password, and if you just signed up verify your email first.";
      }
      if (msg.includes("email not confirmed")) {
        return "Email confirmation is required before login. Please verify from your inbox.";
      }
      return error.message;
    },
    [applySession],
  );

  const signUp = useCallback(
    async (email: string, password: string, householdId: string, isAdmin = false) => {
      try {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) return error.message;

        // If email confirmation is enabled, Supabase returns no session here.
        // In that case RLS will block writing to `profiles` from the client (auth.uid() is null).
        if (!data.session) {
          return "Account created. Please confirm your email from the inbox, then log in.";
        }

        const nextUser = data.user;
        if (!nextUser) return "Signup succeeded but no user was returned.";

        try {
          await ensureProfile(nextUser, {
            joinHouseholdCode: householdId.trim() || undefined,
            isAdmin,
          });
        } catch (err) {
          console.error("[Auth] ensureProfile during signup failed", err);
          return "Signed up, but profile creation failed (likely RLS). Confirm email/login again, or fix Profiles RLS.";
        }

        return null;
      } catch (err) {
        console.error("[Auth] signUp crashed", err);
        return "Signup failed due to a network or unexpected error. Please try again.";
      }
    },
    [],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      session,
      profile,
      profileError,
      loading,
      signIn,
      signUp,
      signOut,
      refreshProfile,
      retryBootstrap,
    }),
    [
      user,
      session,
      profile,
      profileError,
      loading,
      signIn,
      signUp,
      signOut,
      refreshProfile,
      retryBootstrap,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
