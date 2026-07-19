/**
 * djb2 hash of a kerboscript body, base-36. Fast, deterministic,
 * collision-resistant enough for "did the script change since last
 * write" detection. NOT cryptographic — pulling in a real hasher
 * would add bundle weight for zero benefit, since the only consumer
 * is the wrapper's `<path>.ver` sidecar comparison.
 *
 * Returned as an unprefixed positive base-36 string so it's safe to
 * embed in a kOS string literal without needing to escape anything.
 *
 * Resurrected from the deleted KosFiles widget (`git show
 * 855bd024^:mod/GonogoKosUplink/client/src/shared/hashKosScript.ts`) for the
 * `/`-script picker's live drive listing (kos-terminal-script-picker,
 * hub-wizard-kos Phase 1 increment (b)) — same managed-script
 * check-and-write contract, unrelated to any other consumer.
 */
export function hashKosScript(body: string): string {
  let hash = 5381;
  for (let i = 0; i < body.length; i++) {
    // hash * 33 + char, kept in 32-bit signed range with `| 0`.
    hash = (hash * 33 + body.charCodeAt(i)) | 0;
  }
  // Coerce to unsigned for a stable base-36 representation.
  return (hash >>> 0).toString(36);
}
