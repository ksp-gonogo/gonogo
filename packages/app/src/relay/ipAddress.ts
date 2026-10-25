const IPV4 =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const GROUP = /^[0-9a-f]{1,4}$/i;
const ZONE = /^[0-9a-z._~-]+$/i;

/**
 * Whether `text` is an IPv6 address: eight groups of up to four hex digits,
 * or fewer with one `::` standing for the rest, the last 32 bits optionally
 * written as an IPv4 address, and a link-local address optionally followed
 * by `%` and its interface (`fe80::1%eth0`).
 */
export function isIpv6(text: string): boolean {
  const trimmed = text.trim();
  const zoneAt = trimmed.indexOf("%");
  const address = zoneAt < 0 ? trimmed : trimmed.slice(0, zoneAt);
  if (zoneAt >= 0 && !ZONE.test(trimmed.slice(zoneAt + 1))) return false;
  const halves = address.split("::");
  if (halves.length > 2) return false;
  const groupsOf = (part: string) => (part === "" ? [] : part.split(":"));
  const groups = halves.flatMap(groupsOf);
  let width = groups.length;
  const last = groups.at(-1);
  if (last !== undefined && last.includes(".")) {
    if (!IPV4.test(last)) return false;
    groups.pop();
    width += 1;
  }
  if (!groups.every((g) => GROUP.test(g))) return false;
  return halves.length === 2 ? width < 8 : width === 8;
}

/** Whether `text` is an IPv4 or IPv6 address. Host names are not addresses. */
export function isIpAddress(text: string): boolean {
  const trimmed = text.trim();
  return IPV4.test(trimmed) || isIpv6(trimmed);
}
