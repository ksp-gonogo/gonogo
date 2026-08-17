/**
 * Telemachus value helpers: normalising the API's in-band sentinels into the
 * absent/`undefined` values the widgets already handle, so a "no data" sentinel
 * doesn't masquerade as real data.
 */

/**
 * `tar.name` returns this exact string (not "" or null) when nothing is
 * targeted. From the fork's NavigationHandlers.cs:
 *   FlightGlobals.fetch.VesselTarget != null
 *     ? FlightGlobals.fetch.VesselTarget.GetName()
 *     : "No Target Selected.";
 */
export const NO_TARGET_SENTINEL = "No Target Selected.";

/**
 * Resolve `tar.name` to a real target name, or `undefined` when nothing is
 * targeted. Treats the no-target sentinel and empty/blank strings as "no
 * target" so consumers route through their existing undefined-handling
 * instead of rendering a phantom target literally named "No Target Selected.".
 *
 * **Expected to become dead code.** The sentinel is a THIRD way the wire says
 * "nothing", alongside a missing frame and a tombstone, and `vessel.target` is
 * already declared `absenceIsData: true`, so the topic can tombstone and does.
 * Two encodings of absence on one topic, one of them an English sentence in a
 * name field that every consumer has to learn, is the wire doing what the
 * widgets were doing: encoding absence inside a value. A contract change to
 * publish the tombstone alone is routed mod-side; when it lands this function
 * and `NO_TARGET_SENTINEL` go with it. Keep it working until then, and do not
 * build anything new on the sentence.
 */
export function resolveTargetName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === NO_TARGET_SENTINEL) return undefined;
  return raw;
}
