import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type Profile = {
  user_id: string;
  display_name: string;
  avatar_id?: string | null;
};

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  /** OAuth provider name when signed in via social, otherwise null. */
  provider: string | null;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (patch: { display_name?: string; avatar_id?: string }) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Keep track of the previous (anonymous) user_id so we can migrate scores
// after the user upgrades to a real account.
const PREV_ANON_KEY = "wikirace.previousAnonUserId";

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (uid: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("user_id, display_name, avatar_id")
      .eq("user_id", uid)
      .maybeSingle();
    setProfile((data as Profile) ?? null);
  };

  // Move scores from the previous anonymous session onto the new real user.
  const migrateAnonymousScores = async (newUid: string) => {
    const prev = localStorage.getItem(PREV_ANON_KEY);
    if (!prev || prev === newUid) return;
    try {
      const { data, error } = await supabase.rpc("migrate_anonymous_scores", {
        p_from_user: prev,
      });
      if (error) {
        console.warn("score migration failed", error);
        return;
      }
      const moved = typeof data === "number" ? data : 0;
      if (moved > 0) {
        // Toast lazily so we don't add the dependency at module top-level.
        const { toast } = await import("sonner");
        toast.success(`Brought ${moved} guest ${moved === 1 ? "score" : "scores"} with you.`);
      }
      localStorage.removeItem(PREV_ANON_KEY);
    } catch (e) {
      console.warn("score migration threw", e);
    }
  };

  useEffect(() => {
    // Listener FIRST per Supabase guidance.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      const u = sess?.user ?? null;
      setSession(sess);
      setUser(u);

      if (u) {
        if (u.is_anonymous) {
          // Remember the anon UID so we can migrate scores later.
          localStorage.setItem(PREV_ANON_KEY, u.id);
        } else {
          // Real user — try to bring along previous guest scores.
          setTimeout(() => migrateAnonymousScores(u.id), 0);
        }
        // defer to avoid deadlock
        setTimeout(() => loadProfile(u.id), 0);
      } else {
        setProfile(null);
      }
    });

    // Then check existing session.
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user ?? null;
      setSession(data.session);
      setUser(u);
      if (u) {
        if (u.is_anonymous) {
          localStorage.setItem(PREV_ANON_KEY, u.id);
        }
        loadProfile(u.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refreshProfile = async () => {
    if (user?.id) await loadProfile(user.id);
  };

  const updateProfile = async (patch: { display_name?: string; avatar_id?: string }) => {
    if (!user?.id) return;
    const clean: Record<string, string> = {};
    if (patch.display_name !== undefined) {
      const trimmed = patch.display_name.trim().slice(0, 32);
      if (trimmed) clean.display_name = trimmed;
    }
    if (patch.avatar_id !== undefined) clean.avatar_id = patch.avatar_id;
    if (Object.keys(clean).length === 0) return;
    const { error } = await supabase
      .from("profiles")
      .update(clean)
      .eq("user_id", user.id);
    if (error) throw error;
    await loadProfile(user.id);
  };

  // Pull the OAuth provider out of the user identities (if present).
  const provider =
    user?.app_metadata?.provider && user.app_metadata.provider !== "email"
      ? (user.app_metadata.provider as string)
      : user?.is_anonymous
      ? "anonymous"
      : null;

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        loading,
        provider,
        signOut,
        refreshProfile,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
};
