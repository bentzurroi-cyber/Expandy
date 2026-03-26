import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";

export function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [householdId, setHouseholdId] = useState("roy-noy-home");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const nextError =
      mode === "login"
        ? await signIn(email, password)
        : await signUp(email, password, householdId, false);
    setLoading(false);
    setError(nextError);
  }

  const showEmailConfirmHint =
    typeof error === "string" &&
    (error.toLowerCase().includes("invalid login credentials") ||
      error.toLowerCase().includes("email not confirmed"));

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
        </CardContent>
      </Card>
    </div>
  );
}
