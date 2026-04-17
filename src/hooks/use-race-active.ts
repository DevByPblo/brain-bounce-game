import { useEffect, useState } from "react";

/**
 * Tracks whether a race is currently in progress.
 *
 * Pages call `setRaceActive(true)` when entering their playing/racing phase
 * and `setRaceActive(false)` on exit. We mirror the state on `<body>` via a
 * data attribute so any component (e.g. the AuthMenu) can react without a
 * shared context — and so it survives across route boundaries during the
 * brief unmount/mount transition.
 */
const ATTR = "data-race-active";
const EVENT = "race-active-change";

export function setRaceActive(active: boolean) {
  if (typeof document === "undefined") return;
  if (active) {
    document.body.setAttribute(ATTR, "true");
  } else {
    document.body.removeAttribute(ATTR);
  }
  document.dispatchEvent(new CustomEvent(EVENT));
}

export function useRaceActive(): boolean {
  const [active, setActive] = useState<boolean>(
    () => typeof document !== "undefined" && document.body.hasAttribute(ATTR)
  );

  useEffect(() => {
    const handler = () => setActive(document.body.hasAttribute(ATTR));
    document.addEventListener(EVENT, handler);
    return () => document.removeEventListener(EVENT, handler);
  }, []);

  return active;
}
