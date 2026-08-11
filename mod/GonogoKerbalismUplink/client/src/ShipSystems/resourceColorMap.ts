import { resourceColor } from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";

// ---------------------------------------------------------------------------
// Client-side resource-colour PROCESSOR (operator feedback on the Ship
// Systems radiation render pass): turns a live resource-name list into a
// stable `name -> colour` map, wrapping ui-kit's own `resourceColor(name)` as
// the internal. Widgets read the map through `useResourceColorMap`, never
// call `resourceColor` inline per-row: the map is the one source of truth
// for "what colour is this resource" across every row in a render pass, and
// memoising it means a resource's colour is computed once per render pass
// rather than once per row.
//
// Works for any resource name, including a future Uplink's custom resources:
// `resourceColor` itself already falls back to a deterministic hashed hue
// for anything outside its curated table (see that module's own doc
// comment), so an unrecognised name still gets a stable, legible colour
// rather than breaking the map.
// ---------------------------------------------------------------------------

/** NUL-separated: a resource name is never expected to contain a NUL byte,
 *  unlike a space (a third-party Uplink could plausibly name one "Waste
 *  Heat"), so the join/split roundtrip below stays lossless. */
const KEY_SEPARATOR = "\u0000";

/**
 * Stable `name -> colour` map over `names`, recomputed only when the
 * resource SET changes (add/remove a resource), never merely because the
 * caller rebuilt the array reference this render (the common case: Ship
 * Systems derives its resource list fresh from live telemetry every
 * render). Achieved with two memo stages: a cheap sorted/deduped key string
 * first, then the actual colour lookups keyed off THAT string, so a
 * same-membership array with a new reference short-circuits before touching
 * `resourceColor` at all.
 */
export function useResourceColorMap(
  names: readonly string[],
): ReadonlyMap<string, string> {
  const memberKey = useMemo(
    () => [...new Set(names)].sort().join(KEY_SEPARATOR),
    [names],
  );

  return useMemo(() => {
    const map = new Map<string, string>();
    if (memberKey.length === 0) return map;
    for (const name of memberKey.split(KEY_SEPARATOR)) {
      map.set(name, resourceColor(name));
    }
    return map;
  }, [memberKey]);
}
