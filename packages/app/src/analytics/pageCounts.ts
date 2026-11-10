/**
 * Page and journey counts sent to a hosted GoatCounter site: no cookies, no
 * stored identifier, and only fixed strings and the page path leave the
 * browser. Counting is independent of the analytics consent switch, which
 * governs extended logs only.
 *
 * The site code is the one in `docs/homepage/goatcounter.json`, the same value
 * the landing page's build inlines. While it is the placeholder, nothing is sent.
 */

export const PLACEHOLDER_SITE_CODE = "REPLACE_WITH_GOATCOUNTER_SITE_CODE";

export type CountEvent =
  | "arrived-from-landing"
  | "game-connected"
  | "station-joined"
  | "pilot-joined";

/** An address served from this machine or a home network, which lists apart under `/local`. */
export function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    hostname.startsWith("127.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname.endsWith(".local")
  );
}

/**
 * The listing path for a page: `/app/...` and `/rc/...` stay as they are, and
 * any local address gets `/local` in front of the app path. Only the path is
 * listed, never the query, so a join code stays on the device.
 */
export function listingPath(
  pathname: string,
  hostname: string,
  base: string,
): string {
  const relative = pathname.startsWith(base)
    ? `/${pathname.slice(base.length)}`
    : pathname;
  const trimmed = (value: string) =>
    value.length > 1 ? value.replace(/\/+$/, "") : value;
  if (isLocalHost(hostname)) {
    return trimmed(`/local${relative === "/" ? "" : relative}`) || "/local";
  }
  return trimmed(pathname);
}

/** Is `site` a usable GoatCounter site code, not the placeholder or a template token. */
export function isUsableSiteCode(site: string | undefined): site is string {
  return (
    site !== undefined &&
    site !== PLACEHOLDER_SITE_CODE &&
    /^[a-z0-9][a-z0-9-]*$/.test(site)
  );
}

export interface PageCounterEnv {
  site: string | undefined;
  /** False in dev runs and tests, and for automated browsers. */
  enabled: boolean;
  location: Pick<Location, "pathname" | "hostname" | "origin">;
  base: string;
  referrer: string;
  title: string;
  send: (url: string) => void;
}

export interface PageCounter {
  /** Counts this page load once. */
  countPage(): void;
  /** Counts a journey event, at most once per page load. */
  event(name: CountEvent): void;
}

/** Was the previous page the landing page, which is the site root of this same origin. */
function cameFromLanding(referrer: string, origin: string): boolean {
  if (!referrer) return false;
  try {
    const from = new URL(referrer);
    return from.origin === origin && from.pathname === "/";
  } catch {
    return false;
  }
}

export function createPageCounter(env: PageCounterEnv): PageCounter {
  const active = env.enabled && isUsableSiteCode(env.site);
  const sent = new Set<string>();
  const hit = (path: string, isEvent: boolean) => {
    const query = new URLSearchParams({ p: path, t: env.title });
    if (isEvent) query.set("e", "true");
    env.send(`https://${env.site}.goatcounter.com/count?${query.toString()}`);
  };
  const once = (key: string, path: string, isEvent: boolean) => {
    if (!active || sent.has(key)) return;
    sent.add(key);
    hit(path, isEvent);
  };
  return {
    countPage() {
      once(
        "page",
        listingPath(env.location.pathname, env.location.hostname, env.base),
        false,
      );
      if (cameFromLanding(env.referrer, env.location.origin)) {
        once("arrived-from-landing", "arrived-from-landing", true);
      }
    },
    event(name) {
      once(name, name, true);
    },
  };
}

function browserEnv(): PageCounterEnv {
  const automated = globalThis.navigator?.webdriver === true;
  return {
    site:
      typeof __GONOGO_COUNT_SITE__ === "undefined"
        ? undefined
        : __GONOGO_COUNT_SITE__,
    enabled: import.meta.env.PROD && !automated,
    location: globalThis.location,
    base: import.meta.env.BASE_URL,
    referrer: globalThis.document?.referrer ?? "",
    title: globalThis.document?.title ?? "",
    send: (url) => {
      new Image().src = url;
    },
  };
}

let shared: PageCounter | undefined;

/** The counter for this page load. */
export function pageCounter(): PageCounter {
  shared ??= createPageCounter(browserEnv());
  return shared;
}
