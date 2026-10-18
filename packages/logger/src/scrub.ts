import type { LogContext, LogEntry } from "./types.js";

/*
 * Keys whose value is personal or session-identifying wherever they appear in
 * an entry, including inside a bug report's attached recent logs. Compared
 * case-insensitively.
 */
const MASKED_KEYS = new Set([
  "sharecode",
  "address",
  "relatedaddress",
  "ksphost",
  "host",
  "hostname",
  "peerid",
  "stationpeerid",
  "hostpeerid",
  "stationkey",
  "url",
]);

const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)\]]+/gi;
const IPV4_PATTERN = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{2,5})?\b/g;
const IPV6_PATTERN =
  /\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b|(?<![\w:])(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?(?![\w:])/gi;
const STATION_PEER_PATTERN =
  /\bstation-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?:-[\w]+)?/gi;
const IDENTIFIER_ASSIGNMENT_PATTERN =
  /\b(shareCode|peerId|stationPeerId|hostPeerId|stationKey|host|id)=([^\s,)]+)/g;

/** A short stable tag for `value`, so two entries about the same peer still match without saying which peer. */
function tagFor(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function mask(kind: string, value: unknown): string {
  return `<${kind}:${tagFor(String(value))}>`;
}

/*
 * A stack frame's script URL: the scheme and authority (host and port) are
 * masked, the path and the line and column that follow stay readable so the
 * frame still maps through a source map. A query or fragment before the
 * position is dropped. A URL with no authority (file:///...) is masked whole.
 */
const STACK_URL_PATTERN =
  /\b([a-z][a-z0-9+.-]*:\/\/)([^\s"'<>)\]/?#]*)([^\s"'<>)\]]*)/gi;

function scrubStackUrl(
  _url: string,
  scheme: string,
  authority: string,
  rest: string,
): string {
  if (authority === "") return mask("url", scheme + rest);
  const path = rest.replace(/[?#].*?(?=(?::\d+){1,2}$|$)/, "");
  return `${mask("url", scheme + authority)}${path}`;
}

/**
 * Like {@link scrubText} for a stack trace: script URLs keep their path and
 * line:col, so a frame from any engine ("at f (https://h/a.js:1:2)",
 * "f@https://h/a.js:1:2") stays mappable.
 */
export function scrubStack(stack: string): string {
  const protectedUrls: string[] = [];
  const hidden = stack.replace(
    STACK_URL_PATTERN,
    (url, scheme: string, authority: string, rest: string) => {
      protectedUrls.push(scrubStackUrl(url, scheme, authority, rest));
      return `\uE000${protectedUrls.length - 1}\uE000`;
    },
  );
  return scrubText(hidden).replace(
    /\uE000(\d+)\uE000/g,
    (_m, i: string) => protectedUrls[Number(i)],
  );
}

/** Replaces share codes, addresses, host names, peer ids and URLs found inside free text. */
export function scrubText(text: string): string {
  return text
    .replace(URL_PATTERN, (url) => mask("url", url))
    .replace(STATION_PEER_PATTERN, (id) => mask("peer", id))
    .replace(IPV4_PATTERN, (ip) => mask("ip", ip))
    .replace(IPV6_PATTERN, (ip) => mask("ip", ip))
    .replace(
      IDENTIFIER_ASSIGNMENT_PATTERN,
      (_, key: string, value: string) => `${key}=${mask("id", value)}`,
    );
}

function scrubValue(
  value: unknown,
  key: string | undefined,
  parent: string | undefined,
): unknown {
  if (value === null || value === undefined) return value;
  const lowered = key?.toLowerCase();
  const identifying =
    (lowered !== undefined && MASKED_KEYS.has(lowered)) ||
    (parent === "device" && lowered === "id");
  if (identifying && typeof value !== "object")
    return mask(lowered ?? "id", value);
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value))
    return value.map((v) => scrubValue(v, undefined, key));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value))
      out[k] = scrubValue(v, k, lowered);
    return out;
  }
  return value;
}

/**
 * A copy of `entry` with share codes, IP addresses, host names, peer ids and
 * URLs masked, by field name and by pattern in any text, including the recent
 * logs attached to a bug report. A masked value becomes a short tag derived from
 * it, so entries about the same peer still correlate.
 */
export function scrubEntry(entry: LogEntry): LogEntry {
  const scrubbed: LogEntry = { ...entry, message: scrubText(entry.message) };
  if (entry.context) {
    const context: LogContext = {};
    for (const [key, value] of Object.entries(entry.context)) {
      context[key] = scrubValue(value, key, undefined);
    }
    scrubbed.context = context;
  }
  if (entry.error) {
    scrubbed.error = {
      ...entry.error,
      message: scrubText(entry.error.message),
      stack: entry.error.stack && scrubStack(entry.error.stack),
    };
  }
  if (entry.device) {
    const { id, peerId, hostPeerId } = entry.device;
    scrubbed.device = {
      ...entry.device,
      id: id && mask("id", id),
      peerId: peerId && mask("peerid", peerId),
      hostPeerId: hostPeerId && mask("hostpeerid", hostPeerId),
    };
  }
  return scrubbed;
}
