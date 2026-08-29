/**
 * Like `crypto.randomUUID()` but works on insecure-context pages, most notably the
 * LAN-IP dev URL station devices use to reach the dev box, where the Web Crypto
 * spec's secure-context gate makes `randomUUID` hard-throw. Falls back to
 * `crypto.getRandomValues` (available regardless of context) and assembles a v4
 * UUID from the 16 random bytes per RFC 4122.
 *
 * Its own module rather than sitting on the barrel, so `./coverage/CoverageMaskCache.ts` can
 * name it without importing the barrel that re-exports the cache: that cycle would
 * resolve today (the call is at construction, not module eval) and is not worth
 * relying on.
 *
 * A byte-for-byte copy of `@ksp-gonogo/core`'s implementation, not a re-export: it
 * is a pure function with no state and no dependency beyond the `crypto` global, so
 * duplicating it carries none of the second-copy-of-a-registry risk that rules out
 * bundling stateful members, and this leaf cannot name core regardless.
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
