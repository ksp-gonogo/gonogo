/**
 * Which of the two addresses this page load is, from the URL alone. `main` is
 * the local screen at `/`, which reads the game directly and hosts or joins by
 * itself; `join` is `/join`, where a screen joins a game by its code and reads
 * through the host.
 *
 * Base-path-relative: `BASE_URL` is `/` in dev and `/app/` or `/rc/` on GitHub
 * Pages, so the raw pathname is stripped of that prefix before matching,
 * otherwise a sub-path deploy would never match.
 *
 * Read by `main.tsx` before `<App>` mounts as well as by `App`, since the boot
 * sequence branches on it.
 */
export function currentRoute(): "main" | "join" {
  const base = import.meta.env.BASE_URL;
  const path = globalThis.location.pathname;
  const relative = path.startsWith(base) ? `/${path.slice(base.length)}` : path;
  if (relative === "/join" || relative.startsWith("/join/")) return "join";
  return "main";
}

/**
 * Does this page load have no direct socket to the mod, so the boot sequence
 * must skip the live roster probe?
 *
 * A joined screen never has one. On a secure origin nothing can open the mod's
 * insecure socket. Probing anyway costs the full 3-second bound on every
 * hosted boot, logs blocked-request errors in the visitor's console and then
 * records the mod-hash arm as pending, which is a worse answer than not
 * asking. A local screen on `http://` holds its own session and takes the main
 * screen's boot path.
 */
export function bootsWithoutDirectMod(): boolean {
  if (currentRoute() === "join") return true;
  return globalThis.location.protocol === "https:";
}
