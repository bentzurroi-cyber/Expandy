import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { supabase } from '../../lib/supabase';

export function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [householdId, setHouseholdId] = useState("roy-noy-home");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withTimeout<T>(p: Promise<T>, ms = 15000): Promise<T> {
    return await Promise.race([
      p,
      new Promise<T>((_resolve, reject) =>
        window.setTimeout(() => reject(new Error("Request timed out")), ms),
      ),
    ]);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const nextError =
        mode === "login"
          ? await withTimeout(signIn(email, password))
          : await withTimeout(signUp(email, password, householdId, false));
      setError(nextError);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Unknown error during authentication";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const showEmailConfirmHint =
    typeof error === "string" &&
    (error.toLowerCase().includes("invalid login credentials") ||
      error.toLowerCase().includes("email not confirmed"));

      const handleGoogleLogin = async () => {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            // מחזיר את המשתמש לדף הבית של האפליקציה אחרי הכניסה
            redirectTo: window.location.origin, 
          },
        });
        
        if (error) {
          console.error("שגיאה בהתחברות עם גוגל:", error.message);
        }
      };
      
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md items-center px-4">
      <Card className="w-full border-border/80 shadow-none">
        <CardHeader>
          <CardTitle className="text-center">
            {mode === "login" ? "Login to Expandy" : "Sign up to Expandy"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={onSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="auth-email">Email</Label>
              <Input
                id="auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="auth-pass">Password</Label>
              <Input
                id="auth-pass"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            {mode === "signup" ? (
              <div className="space-y-1.5">
                <Label htmlFor="auth-household">Household ID</Label>
                <Input
                  id="auth-household"
                  value={householdId}
                  onChange={(e) => setHouseholdId(e.target.value)}
                  required
                />
              </div>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {showEmailConfirmHint ? (
              <p className="text-xs text-muted-foreground">
                If this is a new account, check your inbox and confirm your email first,
                then try logging in again.
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Please wait..." : mode === "login" ? "Login" : "Create account"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => setMode((prev) => (prev === "login" ? "signup" : "login"))}
            >
              {mode === "login"
                ? "Need an account? Sign up"
                : "Already have an account? Login"}
            </Button>
          </form>
          <div className="relative my-4">
  <div className="absolute inset-0 flex items-center">
    <span className="w-full border-t border-gray-300"></span>
  </div>
  <div className="relative flex justify-center text-xs uppercase">
    <span className="bg-background px-2 text-muted-foreground">או המשך עם</span>
  </div>
</div>

<button
  type="button"
  onClick={handleGoogleLogin}
  className="w-full flex items-center justify-center gap-2 bg-white text-gray-700 border border-gray-300 py-2 px-4 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
>
  <img 
    src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" 
    alt="Google" 
    className="w-5 h-5"
  />
  Google
</button>
        </CardContent>
      </Card>
    </div>
  );
}
