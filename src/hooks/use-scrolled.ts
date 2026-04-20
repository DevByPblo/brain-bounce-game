import { useEffect, useState } from "react";

/**
 * Returns true once the window has been scrolled past `threshold` pixels.
 * Used to switch the in-game sticky header into a compact mode.
 *
 * Anti-flicker design:
 * - When the header collapses it shrinks the document, which on short pages
 *   drops scrollY below the threshold and would normally re-expand the header,
 *   causing an open/close loop. To avoid this we use an asymmetric rule:
 *     • turn ON  at `threshold`
 *     • turn OFF only when the user is essentially back at the top (≤ 4px)
 * - Scroll handling is rAF-throttled so we never thrash layout.
 */
export function useScrolled(threshold = 24): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onAt = threshold;
    const offAt = 4; // must scroll all the way back to top to expand again
    let ticking = false;
    let current = false;

    const update = () => {
      ticking = false;
      const y = window.scrollY || document.documentElement.scrollTop;
      const next = current ? y > offAt : y > onAt;
      if (next !== current) {
        current = next;
        setScrolled(next);
      }
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}
