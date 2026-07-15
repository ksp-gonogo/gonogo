import type { CommsPath } from "@ksp-gonogo/sitrep-sdk";

/**
 * `Sitrep.Contract.CommsHopKind` ordinals (`mod/Sitrep.Contract/Comms.cs`) —
 * hand-mirrored rather than importing the generated TS enum as a runtime
 * value, matching this codebase's own precedent for small ordinal constants
 * (`vessel-state.ts`'s `TRANSITION_TYPE_ENCOUNTER`/`SystemView/index.tsx`'s
 * identical pair). Keeps `@ksp-gonogo/sitrep-sdk` a type-only import here.
 */
const COMMS_HOP_KIND_RELAY = 1;

/**
 * Human-readable hop chain for a `comms.path` payload — the hover-detail
 * text behind the comms-path highlight line (a cheap stand-in for the
 * deferred click-to-detail panel, spec'd out of the Phase 1 spine). `undefined`/
 * empty hops both render the same "No comms path home" text — per
 * `CommsPath`'s own doc, an empty hop list is a REAL control-loss state, not
 * absence of data, so it gets an explicit message rather than blank.
 */
export function describeCommsPath(path: CommsPath | undefined): string {
  if (!path || path.hops.length === 0) return "No comms path home";
  const names: string[] = [path.hops[0].from];
  let relays = 0;
  for (const hop of path.hops) {
    names.push(hop.to);
    if (hop.kind === COMMS_HOP_KIND_RELAY) relays++;
  }
  const relaySuffix =
    relays > 0 ? ` (${relays} relay${relays === 1 ? "" : "s"})` : "";
  return `${names.join(" -> ")}${relaySuffix}`;
}
