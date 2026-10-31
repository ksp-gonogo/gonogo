// Shared role-detection helper (#6, station boot re-sequence), extracted
// from `App.tsx` so `main.tsx` can branch its boot sequence on the same
// exact rule before `<App>` ever mounts: the station path must skip the
// main screen's direct-fetch loader entirely (see main.tsx's doc comment),
// so the decision has to be available at the module-load boot call site,
// not just inside the rendered component tree.

/**
 * Which deployment configuration this page load is, from the URL alone.
 *
 * Base-path-relative: `BASE_URL` is `/` in dev and `/app/` or `/rc/` on GitHub
 * Pages, so the raw pathname is stripped of that prefix before matching,
 * otherwise a sub-path deploy would never match.
 */
export function currentRoute(): "main" | "station" | "pilot" {
  const base = import.meta.env.BASE_URL;
  const path = globalThis.location.pathname;
  const relative = path.startsWith(base) ? `/${path.slice(base.length)}` : path;
  if (relative.startsWith("/station")) return "station";
  if (relative.startsWith("/pilot")) return "pilot";
  return "main";
}

/**
 * Is this page load a station (`/station`) rather than the main screen
 * (`/`)?
 *
 * Kept as its own predicate rather than folded into `currentRoute` at every
 * call site. What the boot sequence branches on is a different question, and
 * has its own predicate below: see `bootsWithoutDirectMod`.
 */
export function isStationRoute(): boolean {
  return currentRoute() === "station";
}

/**
 * Does this page load have no direct socket to the mod, so the boot sequence
 * must skip the live roster probe?
 *
 * A station never has one. On a secure origin nothing can open the mod's
 * insecure socket: the main screen there is only the hosted landing page, and a
 * pilot reads its telemetry over the peer link (`PilotScreen` picks the
 * transport by the same test). Probing anyway costs the full 3-second bound on
 * every hosted boot, logs blocked-request errors in the visitor's console and
 * then records the mod-hash arm as pending, which is a worse answer than not
 * asking. A pilot on `http://` holds its own session at its own vantage and
 * takes the main screen's boot path.
 */
export function bootsWithoutDirectMod(): boolean {
  if (currentRoute() === "station") return true;
  return globalThis.location.protocol === "https:";
}
