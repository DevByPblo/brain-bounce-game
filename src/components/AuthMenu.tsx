import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Check, LogIn, LogOut, Pencil, User as UserIcon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AVATARS, getAvatar } from "@/lib/avatars";
import { useRaceActive } from "@/hooks/use-race-active";
import { toast } from "sonner";

const ProviderBadge = ({ provider }: { provider: string | null }) => {
  if (!provider || provider === "anonymous") return null;
  if (provider === "google") {
    return (
      <span className="inline-flex items-center gap-1 small-caps text-[9px] text-ink-faint">
        <svg className="w-3 h-3" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Signed in with Google
      </span>
    );
  }
  return (
    <span className="small-caps text-[9px] text-ink-faint capitalize">
      Signed in with {provider}
    </span>
  );
};

const AvatarChip = ({
  avatarId,
  size = "sm",
}: {
  avatarId?: string | null;
  size?: "sm" | "md";
}) => {
  const a = getAvatar(avatarId);
  const dim = size === "sm" ? "w-6 h-6 text-sm" : "w-10 h-10 text-xl";
  return (
    <span
      className={`${dim} ${a.bg} ${a.fg} rounded-full flex items-center justify-center shrink-0 border border-rule`}
      aria-label={a.label}
    >
      {a.emoji}
    </span>
  );
};

/**
 * Optional sign-in widget pinned to the top-right of every page.
 * - Hidden on /auth itself.
 * - Anonymous Supabase sessions still see "Sign in".
 */
export const AuthMenu = () => {
  const { user, profile, loading, provider, signOut, updateProfile } = useAuth();
  const { pathname } = useLocation();
  const raceActive = useRaceActive();
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setDraftName(profile?.display_name ?? "");
      setEditingName(false);
    }
  }, [open, profile?.display_name]);

  if (pathname === "/auth") return null;
  if (loading) return null;
  if (raceActive) return null;

  const isAnon = !user || user.is_anonymous === true;

  if (isAnon) {
    return (
      <div className="fixed top-2 right-2 sm:top-3 sm:right-3 z-50 flex items-center gap-2">
        <Link to="/achievements" title="Achievements">
          <Button variant="outline" size="sm" className="paper-card shadow-sm h-8 px-2.5">
            <Trophy className="w-3.5 h-3.5" />
          </Button>
        </Link>
        <Link to="/auth">
          <Button variant="outline" size="sm" className="paper-card shadow-sm h-8 px-2.5">
            <LogIn className="w-3.5 h-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">Sign in</span>
          </Button>
        </Link>
      </div>
    );
  }

  const name = profile?.display_name ?? user.email ?? "Account";

  const saveName = async () => {
    if (!draftName.trim() || draftName.trim() === profile?.display_name) {
      setEditingName(false);
      return;
    }
    setSaving(true);
    try {
      await updateProfile({ display_name: draftName });
      toast.success("Name updated");
      setEditingName(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't save name");
    } finally {
      setSaving(false);
    }
  };

  const pickAvatar = async (id: string) => {
    if (id === profile?.avatar_id) return;
    try {
      await updateProfile({ avatar_id: id });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't save avatar");
    }
  };

  return (
    <div className="fixed top-2 right-2 sm:top-3 sm:right-3 z-50">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="paper-card shadow-sm gap-1.5 h-8 pl-1 pr-2 sm:pr-2.5"
          >
            <AvatarChip avatarId={profile?.avatar_id} />
            <span className="serif max-w-[100px] sm:max-w-[140px] truncate hidden sm:inline">
              {name}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-[260px] sm:w-72 paper-card"
        >
          <DropdownMenuLabel className="serif pb-2">
            <div className="flex items-start gap-3">
              <AvatarChip avatarId={profile?.avatar_id} size="md" />
              <div className="min-w-0 flex-1">
                {editingName ? (
                  <div className="flex gap-1">
                    <Input
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveName();
                        if (e.key === "Escape") setEditingName(false);
                      }}
                      maxLength={32}
                      className="h-7 text-sm"
                    />
                    <Button
                      size="sm"
                      onClick={() => void saveName()}
                      disabled={saving}
                      className="h-7 px-2"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingName(true)}
                    className="group flex items-center gap-1.5 text-left"
                  >
                    <span className="font-semibold truncate">{name}</span>
                    <Pencil className="w-3 h-3 text-ink-faint group-hover:text-primary shrink-0" />
                  </button>
                )}
                <div className="text-[11px] text-ink-faint font-normal truncate mt-0.5">
                  {user.email ?? "Guest account"}
                </div>
                <div className="mt-1">
                  <ProviderBadge provider={provider} />
                </div>
              </div>
            </div>
          </DropdownMenuLabel>

          <DropdownMenuSeparator />

          <div className="px-2 py-1.5">
            <div className="small-caps text-[9px] text-ink-faint mb-1.5 px-1">
              Avatar
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {AVATARS.map((a) => {
                const active = profile?.avatar_id === a.id;
                return (
                  <button
                    key={a.id}
                    onClick={() => void pickAvatar(a.id)}
                    title={a.label}
                    className={`aspect-square rounded-md flex items-center justify-center text-lg transition ${a.bg} ${a.fg} ${
                      active
                        ? "ring-2 ring-primary"
                        : "hover:ring-1 hover:ring-rule"
                    }`}
                  >
                    {a.emoji}
                  </button>
                );
              })}
            </div>
          </div>

          <DropdownMenuSeparator />

          <Link to="/achievements">
            <DropdownMenuItem className="cursor-pointer">
              <Trophy className="w-3.5 h-3.5 mr-2" />
              Achievements
            </DropdownMenuItem>
          </Link>

          <DropdownMenuItem
            onClick={async () => {
              await signOut();
              toast.success("Signed out");
            }}
            className="cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5 mr-2" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
