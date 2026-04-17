import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, LogIn, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

const Auth = () => {
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate("/");
  }, [user, navigate]);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (tab === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { display_name: displayName.trim() || email.split("@")[0] },
          },
        });
        if (error) throw error;
        toast.success("Account created. You're logged in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative z-10 min-h-screen flex items-center justify-center px-6 py-16">
      <div className="max-w-md w-full">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 small-caps text-xs text-ink-soft hover:text-primary mb-8"
        >
          <ArrowLeft className="w-3 h-3" /> Back
        </Link>
        <div className="text-center mb-8">
          <h1 className="serif text-4xl font-extrabold tracking-tight mb-2">
            Wiki<span className="italic text-primary">Race</span>
          </h1>
          <p className="serif italic text-muted-foreground text-sm">
            Sign in to save your scores to the global board.
          </p>
        </div>

        <div className="paper-card p-6">
          <div className="grid grid-cols-2 gap-1 p-1 bg-muted/50 rounded-md mb-6">
            <button
              onClick={() => setTab("login")}
              className={`text-sm py-2 rounded transition-colors ${
                tab === "login" ? "bg-card shadow-sm font-semibold" : "text-ink-soft"
              }`}
            >
              Sign in
            </button>
            <button
              onClick={() => setTab("signup")}
              className={`text-sm py-2 rounded transition-colors ${
                tab === "signup" ? "bg-card shadow-sm font-semibold" : "text-ink-soft"
              }`}
            >
              Create account
            </button>
          </div>

          <form onSubmit={handle} className="space-y-4">
            {tab === "signup" && (
              <div>
                <Label htmlFor="name">Display name</Label>
                <Input
                  id="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Shown on the leaderboard"
                  maxLength={32}
                  required
                />
              </div>
            )}
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
                autoComplete={tab === "signup" ? "new-password" : "current-password"}
              />
            </div>

            {error && <p className="text-destructive text-sm">{error}</p>}

            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : tab === "signup" ? (
                <UserPlus className="w-4 h-4 mr-2" />
              ) : (
                <LogIn className="w-4 h-4 mr-2" />
              )}
              {tab === "signup" ? "Create account" : "Sign in"}
            </Button>
          </form>
        </div>

        <p className="text-[11px] text-ink-faint text-center mt-6">
          You can play all modes without an account. Sign in only to save scores.
        </p>
      </div>
    </main>
  );
};

export default Auth;
