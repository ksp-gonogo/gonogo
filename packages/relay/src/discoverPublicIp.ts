/**
 * Discover the relay's public IP — the address coturn must advertise to
 * clients in its `relay` ICE candidates. Without this, coturn falls
 * back to the container's bridge IP (e.g. `10.89.7.x`), which only
 * routes inside the compose network and renders relay candidates
 * useless to anyone on the actual internet.
 *
 * Operator override: `TURN_EXTERNAL_IP` env. Auto-discovery is the
 * common path; the override exists for unusual setups (multi-WAN,
 * IPv6-only, an explicit DDNS hostname, etc.).
 *
 * Lookup service: a few rotating well-known plain-text endpoints. They
 * all return just an IP. We don't trust any single one — first to
 * answer wins.
 */

const LOOKUP_URLS = [
  "https://api.ipify.org",
  "https://ifconfig.me/ip",
  "https://icanhazip.com",
];

const LOOKUP_TIMEOUT_MS = 4_000;

export interface DiscoverOptions {
  override?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  urls?: readonly string[];
}

/**
 * Resolve the relay's public IP. Returns the override if set, otherwise
 * races multiple lookup services and returns the first valid response.
 * Throws if every lookup fails — the caller decides whether to retry,
 * fall back to a sentinel, or refuse to start coturn.
 */
export async function discoverPublicIp(
  opts: DiscoverOptions = {},
): Promise<string> {
  const override = opts.override?.trim();
  if (override) return override;

  const urls = opts.urls ?? LOOKUP_URLS;
  const timeoutMs = opts.timeoutMs ?? LOOKUP_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;

  // Race them — the first valid IP wins. Failures and timeouts on the
  // others are swallowed because we already have an answer.
  const attempts = urls.map((url) => attemptLookup(url, timeoutMs, fetchImpl));
  return await Promise.any(attempts);
}

async function attemptLookup(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    const body = (await res.text()).trim();
    if (!isPlausibleIp(body)) {
      throw new Error(`${url} → not an IP: ${body.slice(0, 64)}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;

function isPlausibleIp(s: string): boolean {
  if (!s) return false;
  // Don't validate exhaustively — coturn will reject a malformed
  // address. We just want to filter out HTML error pages and the like.
  return IPV4_RE.test(s) || (s.includes(":") && IPV6_RE.test(s));
}
