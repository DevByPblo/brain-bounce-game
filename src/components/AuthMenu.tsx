import { Link, useLocation } from "react-router-dom";
import { LogIn, LogOut, User as UserIcon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

/**
 * Optional sign-in widget pinned to the top-right of every page.
 * - Hidden on /auth itself (the page is the form).
 * - Anonymous Supabase sessions are treated as guests, so they still see "Sign in".
 */
export const AuthMenu = () => {
  const { user, profile, loading, signOut } = useAuth();
  const { pathname } = useLocation();

  if (pathname === "/auth") return null;
  if (loading) return null;

  // Guests OR anonymous Supabase sessions show the Sign-in CTA.
  const isAnon = !user || user.is_anonymous === true;

  if (isAnon) {
    return (
      <div className="fixed top-3 right-3 z-50">
        <Link to="/auth">
          <Button variant="outline" size="sm" className="paper-card shadow-sm">
            <LogIn className="w-3.5 h-3.5 mr-1.5" />
            Sign in
          </Button>
        </Link>
      </div>
    );
  }

  const name = profile?.display_name ?? user.email ?? "Account";
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="fixed top-3 right-3 z-50">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="paper-card shadow-sm gap-2">
            <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center">
              {initials || <UserIcon className="w-3 h-3" />}
            </span>
            <span className="serif max-w-[120px] truncate">{name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="serif">
            <div className="font-semibold truncate">{name}</div>
            <div className="text-[11px] text-ink-faint font-normal truncate">
              {user.email}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
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
