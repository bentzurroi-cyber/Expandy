import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, type ProfileRow } from "@/lib/supabase";

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

async function withTimeout<T>(run: () => Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    run(),
    new Promise<T>((_resolve, reject) => {
      window.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function newHouseholdId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `household-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

async function ensureProfile(
  user: User,
  householdId?: string,
  isAdmin = false,
  fallbackHouseholdId = "roy-noy-home",
) {
  const email = user.email?.trim().toLowerCase() ?? "";
  if (!email) return;
  console.log("[Auth] Profile fetch started", { userId: user.id });
  const { data: existing, error } = await supabase
    .from("profiles")
    .select("id, email, household_id, is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (error) {
    console.error("[Auth] Profile fetch failed", { userId: user.id, error: error.message });
  }
  if (existing) {
    console.log("[Auth] Profile found", {
      userId: user.id,
      householdId: existing.household_id,
    });
    if (!existing.household_id) {
      const assigned = householdId?.trim() || fallbackHouseholdId;
      await supabase
        .from("profiles")
        .update({ household_id: assigned })
        .eq("id", user.id);
      console.log("[Auth] Household ID assigned", { userId: user.id, householdId: assigned });
    }
    return;
  }
  console.log("[Auth] Profile not found", { userId: user.id });

  const resolvedHousehold = householdId?.trim() || fallbackHouseholdId;

  const { error: upsertError } = await supabase.from("profiles").upsert({
    id: user.id,
    email,
    household_id: resolvedHousehold,
    is_admin: isAdmin,
  });
  if (upsertError) {
    console.error("[Auth] Profile upsert failed", { userId: user.id, error: upsertError.message });
  }
  console.log("[Auth] Household ID assigned", {
    userId: user.id,
    householdId: resolvedHousehold,
  });
}

async function forceCreateProfile(user: User): Promise<ProfileRow | null> {
  const email = user.email?.trim().toLowerCase() ?? "";
  if (!email) return null;
  const assigned = newHouseholdId();
  const payload: ProfileRow = {
    id: user.id,
    email,
    household_id: assigned,
    is_admin: false,
  };
  const { data, error } = await supabase
    .from("profiles")
    .upsert(payload)
    .select("id, email, household_id, is_admin")
    .maybeSingle();
  if (error) {
    console.log("[Auth] forceCreateProfile failed", { userId: user.id, error: error.message });
    return null;
  }
  console.log("[Auth] Household ID assigned", { userId: user.id, householdId: assigned });
  return (data as ProfileRow | null) ?? payload;
}

function guestProfileFor(user: User): ProfileRow {
  return {
    id: user.id,
    email: user.email?.trim().toLowerCase() ?? "",
    household_id: "roy-noy-home",
    is_admin: false,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const bootstrappedRef = useRef(false);
  const authRefreshInFlightRef = useRef(false);

  const fetchProfileByUserId = useCallback(async (userId: string) => {
    console.log("[Auth] Profile fetch started", { userId });
    const { data, error } = await withTimeout(
      async () =>
        await supabase
          .from("profiles")
          .select("id, email, household_id, is_admin")
          .eq("id", userId)
          .maybeSingle(),
      5000,
      "Profile fetch",
    );
    if (error) {
      console.error("[Auth] Profile fetch failed", { userId, error: error.message });
      return null;
    }
    console.log(data ? "[Auth] Profile found" : "[Auth] Profile not found", { userId });
    return data ?? null;
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
      console.log("[Auth] Auth session detected", {
        hasSession: Boolean(nextSession),
        userId: nextSession?.user?.id,
      });
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setProfileError(null);
      if (!nextSession?.user) {
        setProfile(null);
        return;
      }
      try {
        await ensureProfile(nextSession.user);
      } catch (err) {
        console.error("[Auth] ensureProfile failed", err);
      }
      try {
        const nextProfile = await fetchProfileByUserId(nextSession.user.id);
        if (!nextProfile) {
          const forced = await forceCreateProfile(nextSession.user);
          if (forced) {
            setProfile(forced);
            setProfileError(null);
          } else {
            await ensureProfile(nextSession.user, "roy-noy-home", false, "roy-noy-home");
            const recovered = await fetchProfileByUserId(nextSession.user.id);
            setProfile(recovered);
            if (!recovered) {
              setProfile(guestProfileFor(nextSession.user));
              setProfileError("Profile not found in database");
            }
          }
        } else {
          setProfile(nextProfile);
          setProfileError(null);
        }
      } catch (err) {
        console.error("[Auth] profile hydrate failed", err);
        setProfile(guestProfileFor(nextSession.user));
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
    if (authRefreshInFlightRef.current) return;
    authRefreshInFlightRef.current = true;
    setLoading(true);
    setProfileError(null);
    try {
      const { data } = await supabase.auth.getSession();
      console.log("[Auth] getSession completed");
      await applySession(data.session);
      if (data.session?.user) {
        const refreshed = await fetchProfileByUserId(data.session.user.id);
        if (!refreshed) setProfileError("Profile not found in database");
        else setProfile(refreshed);
      }
    } catch (err) {
      console.error("[Auth] retry bootstrap failed", err);
      setProfileError(
        err instanceof Error ? `Retry failed: ${err.message}` : "Retry failed",
      );
    } finally {
      authRefreshInFlightRef.current = false;
      setLoading(false);
    }
  }, [applySession, fetchProfileByUserId]);

  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    let cancelled = false;

    const bootstrapSession = async (setUiLoading: boolean) => {
      if (authRefreshInFlightRef.current) return;
      authRefreshInFlightRef.current = true;
      if (setUiLoading && !cancelled) {
        setLoading(true);
        setProfileError(null);
      }
      try {
        const { data } = await supabase.auth.getSession();
        console.log("[Auth] getSession completed");
        if (cancelled) return;
        await applySession(data.session);
      } catch (err) {
        console.error("[Auth] initial bootstrap failed", err);
        if (!cancelled && setUiLoading) {
          setSession(null);
          setUser(null);
          setProfile(null);
          setProfileError(
            err instanceof Error ? `Bootstrap failed: ${err.message}` : "Bootstrap failed",
          );
        }
      } finally {
        authRefreshInFlightRef.current = false;
        if (!cancelled && setUiLoading) setLoading(false);
      }
    };

    void (async () => {
      await bootstrapSession(true);
    })();

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, nextSession) => {
        if (cancelled) return;
        if (authRefreshInFlightRef.current) return;
        authRefreshInFlightRef.current = true;
        setLoading(true);
        try {
          await applySession(nextSession);
        } catch (err) {
          console.error("[Auth] auth state handler failed", err);
          if (!cancelled) {
            setProfileError(
              err instanceof Error
                ? `Auth state failed: ${err.message}`
                : "Auth state failed",
            );
          }
        } finally {
          authRefreshInFlightRef.current = false;
          if (!cancelled) setLoading(false);
        }
      },
    );

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      void bootstrapSession(false);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      listener.subscription.unsubscribe();
    };
  }, [applySession]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (!error) return null;
    const msg = error.message.toLowerCase();
    if (msg.includes("invalid login credentials")) {
      return "Invalid login credentials. Check email/password, and if you just signed up verify your email first.";
    }
    if (msg.includes("email not confirmed")) {
      return "Email confirmation is required before login. Please verify from your inbox.";
    }
    return error.message;
  }, []);

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
          await ensureProfile(nextUser, householdId, isAdmin);
        } catch (err) {
          console.log("[Auth] ensureProfile during signup failed", err);
          return "Signed up, but profile creation failed (likely RLS). Confirm email/login again, or fix Profiles RLS.";
        }

        return null;
      } catch (err) {
        console.log("[Auth] signUp crashed", err);
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
