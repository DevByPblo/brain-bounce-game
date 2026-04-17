// Tiny library of selectable avatars for the player profile.
// Stored as an ID on profiles.avatar_id (text). No image assets needed —
// the avatar is just a labelled emoji rendered inside a coloured chip.

export type Avatar = {
  id: string;
  emoji: string;
  label: string;
  // tailwind classes for the chip background + text
  bg: string;
  fg: string;
};

export const AVATARS: Avatar[] = [
  { id: "owl",       emoji: "🦉", label: "Owl",       bg: "bg-amber-100",  fg: "text-amber-700" },
  { id: "fox",       emoji: "🦊", label: "Fox",       bg: "bg-orange-100", fg: "text-orange-700" },
  { id: "octopus",   emoji: "🐙", label: "Octopus",   bg: "bg-pink-100",   fg: "text-pink-700" },
  { id: "rocket",    emoji: "🚀", label: "Rocket",    bg: "bg-sky-100",    fg: "text-sky-700" },
  { id: "scroll",    emoji: "📜", label: "Scroll",    bg: "bg-stone-100",  fg: "text-stone-700" },
  { id: "compass",   emoji: "🧭", label: "Compass",   bg: "bg-emerald-100",fg: "text-emerald-700" },
  { id: "feather",   emoji: "🪶", label: "Feather",   bg: "bg-violet-100", fg: "text-violet-700" },
  { id: "telescope", emoji: "🔭", label: "Telescope", bg: "bg-indigo-100", fg: "text-indigo-700" },
];

export const DEFAULT_AVATAR: Avatar = AVATARS[0];

export const getAvatar = (id?: string | null): Avatar =>
  AVATARS.find((a) => a.id === id) ?? DEFAULT_AVATAR;
