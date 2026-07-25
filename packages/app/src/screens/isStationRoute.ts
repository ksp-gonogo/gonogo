// Shared role-detection helper (#6, station boot re-sequence) — extracted
// from `App.tsx` so `main.tsx` can branch its boot sequence on the same
// exact rule before `<App>` ever mounts: the station path must skip the
// main screen's direct-fetch loader entirely (see main.tsx's doc comment),
// so the decision has to be available at the module-load boot call site,
// not just inside the rendered component tree.

/**
 * Is this page load a station (`/station`) rather than the main screen
 * (`/`)? Base-path-relative: `BASE_URL` is `/` in dev and `/gonogo/` on
 * GitHub Pages, so the raw pathname is stripped of that prefix before the
 * `/station` match — otherwise a sub-path deploy would never match.
 */
export function isStationRoute(): boolean {
  const base = import.meta.env.BASE_URL;
  const path = globalThis.location.pathname;
  const relative = path.startsWith(base) ? `/${path.slice(base.length)}` : path;
  return relative.startsWith("/station");
}
