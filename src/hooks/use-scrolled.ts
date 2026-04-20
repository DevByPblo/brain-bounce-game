import { useEffect, useState } from "react";

/**
 * Returns true once the window has been scrolled past `threshold` pixels.
 * Used to switch the in-game sticky header into a compact mode.
 *
 * Uses hysteresis (different on/off thresholds) so the header doesn't flap
 * open/closed when the user is scrolling near the boundary, and rAF-throttles
 * scroll handling to avoid layout thrashing.
 */
export function useScrolled(threshold = 24): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onThreshold = threshold;
    const offThreshold = Math.max(0, threshold - 24); // 24px deadband
    let ticking = false;
    let current = false;

    const update = () => {
      ticking = false;
      const y = window.scrollY || document.documentElement.scrollTop;
      const next = current ? y > offThreshold : y > onThreshold;
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
