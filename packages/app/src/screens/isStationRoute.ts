// Shared role-detection helper (#6, station boot re-sequence), extracted
// from `App.tsx` so `main.tsx` can branch its boot sequence on the same
// exact rule before `<App>` ever mounts: the station path must skip the
// main screen's direct-fetch loader entirely (see main.tsx's doc comment),
// so the decision has to be available at the module-load boot call site,
// not just inside the rendered component tree.

/**
 * Which deployment configuration this page load is, from the URL alone.
 *
 * Base-path-relative: `BASE_URL` is `/` in dev and `/gonogo/` on GitHub
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
 * call site, because what the boot sequence actually branches on is "does
 * this screen talk to KSP directly", and a PILOT does: it holds its own
 * session at its own vantage, so it takes the main screen's boot path and
 * only a station skips it.
 */
export function isStationRoute(): boolean {
  return currentRoute() === "station";
}
