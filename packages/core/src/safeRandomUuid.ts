/**
 * Like `crypto.randomUUID()` but works on insecure-context pages — most
 * notably the LAN-IP dev URL (`http://192.168.x.x:5173`) station devices
 * use to reach the dev box. The Web Crypto spec gates `randomUUID` on a
 * secure context, so any code path that goes through it (KosTerminal's
 * pty session id, save-profile / alarm / maneuver-trigger ids, peer
 * RPC request ids) hard-throws under that origin and trips the
 * ErrorBoundary.
 *
 * The fallback uses `crypto.getRandomValues`, which is available in
 * every modern browser regardless of context, and assembles a v4 UUID
 * from the 16 random bytes per RFC 4122.
 */
export function safeRandomUuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
