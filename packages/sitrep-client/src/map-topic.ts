/**
 * Kinematics → `vessel.state.*` routing (M2 design §6 "the `mapTopic` shim";
 * M1 §6.2/§8.2's V-12-prevention rule: "`mapTopic` points kinematics at
 * `vessel.state.*` derived subtopics from the FIRST migrated widget"). The
 * full old-Telemachus-key migration table (`m1-provider-taxonomy-design.md`
 * §5) is M3-scoped and lives in `@gonogo/core`'s eventual `useDataValue`
 * shim, not here — this is the narrow seed that table depends on: the
 * kinematics keys specifically named in M1 §6.2 as the dual-representation
 * risk (position/velocity/altitude have a raw-looking `vessel.flight`/
 * `vessel.orbit` twin that a widget author could reach for by mistake).
 *
 * Two input shapes are handled:
 * - **Short semantic keys** (`"altitude"`, `"velocity"`, `"position"`,
 *   `"orbitalSpeed"`) — forward-compatible with the eventual `@gonogo/core`
 *   migration table's short old-key style (`v.altitude`, `o.orbitalSpeed`).
 * - **Raw topic strings a widget might reach for directly** —
 *   `"vessel.flight.altitudeAsl"` is redirected to `"vessel.state.altitudeAsl"`
 *   even though the raw field genuinely exists on the wire, because binding a
 *   widget straight to it reproduces the dual-altitude wart `vessel.state`
 *   exists to kill (M1 §6.2). Same story for `"vessel.flight.orbitalSpeed"`
 *   → `"vessel.state.orbitalSpeed"` — `vessel.flight` (`VesselFlightPayload`)
 *   is the actual raw twin carrying `orbitalSpeed` on the wire; `vessel.orbit`
 *   (`VesselOrbitPayload`) is elements-only (sma/ecc/inc/lan/argPe/…) and has
 *   no `orbitalSpeed` field at all, so a redirect keyed on that topic would
 *   never fire and leave the real raw measurement unguarded (V-12 risk).
 *   Non-kinematic keys (surface-frame-only measurements with no
 *   elements-derived twin, e.g. `vessel.flight.mach`,
 *   `vessel.flight.dynamicPressureKPa`) are deliberately NOT redirected —
 *   per the M1 §5.1 migration table those stay raw; there's no dual
 *   representation to collapse.
 *
 * Anything not in the table passes through unchanged (identity fallback) —
 * `mapTopic` is safe to call on every key, not just kinematic ones.
 */
const KINEMATIC_REDIRECTS: Readonly<Record<string, string>> = {
  // Short semantic aliases.
  position: "vessel.state.position",
  velocity: "vessel.state.velocity",
  altitude: "vessel.state.altitudeAsl",
  altitudeAsl: "vessel.state.altitudeAsl",
  orbitalSpeed: "vessel.state.orbitalSpeed",
  // Raw-topic interception — a widget asking for these directly still lands
  // on the quality-picked surface, never the raw measurement/element field.
  "vessel.flight.altitudeAsl": "vessel.state.altitudeAsl",
  "vessel.flight.orbitalSpeed": "vessel.state.orbitalSpeed",
};

/**
 * Resolve a widget-facing key to the SDK topic it should actually subscribe
 * to. Kinematics (position/velocity/altitude/orbital speed) always resolve
 * to `vessel.state.*`; everything else passes through unchanged.
 */
export function mapTopic(key: string): string {
  return KINEMATIC_REDIRECTS[key] ?? key;
}
