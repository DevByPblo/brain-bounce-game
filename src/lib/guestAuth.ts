// Ensure there's *some* Supabase session so RLS-gated inserts (scores) work.
// If the user isn't signed in, transparently create an anonymous session and
// give them a fun random display name on their auto-created profile.
import { supabase } from "@/integrations/supabase/client";
import { getPlayerName } from "@/lib/player";

export async function ensureSession(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user) return data.session.user.id;

  const { data: anon, error } = await supabase.auth.signInAnonymously();
  if (error || !anon.user) {
    console.error("anon sign-in failed", error);
    return null;
  }

  // Profile row is created by the handle_new_user trigger with a fallback
  // "Anonymous" name. Replace it with the local random handle if present.
  const name = getPlayerName();
  await supabase
    .from("profiles")
    .update({ display_name: name })
    .eq("user_id", anon.user.id);

  return anon.user.id;
}
