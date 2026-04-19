import { useEffect } from "react";

/**
 * While `active` is true, blocks the browser's in-page Find shortcut
 * (Ctrl/Cmd+F, F3) so players can't cheat by searching the article DOM
 * for the target word. Other keys are untouched.
 *
 * Note: Browsers don't allow JS to fully suppress the menu-driven Find,
 * but intercepting the keyboard shortcut covers ~all real-world cheating.
 */
export function useBlockFind(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      const isFindShortcut =
        ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) ||
        e.key === "F3";
      if (isFindShortcut) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true } as EventListenerOptions);
  }, [active]);
}
