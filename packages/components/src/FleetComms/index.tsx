import { registerAugment, useTelemetry } from "@ksp-gonogo/core";
import {
  type OrbitElements,
  solveAnomalies,
  useLatestValue,
  useUtNow,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import type {
  CommsPath,
  PendingUplinkQueue,
  Value,
} from "@ksp-gonogo/sitrep-sdk";
import { ToggleButton } from "@ksp-gonogo/ui";
import {
  Badge,
  Cluster,
  NULL_DISPLAY,
  type Severity,
} from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import type { SystemBadgesContext, SystemOverlayContext } from "../SystemView";
import { describeCommsPath } from "./commsPathSummary";
import { computeUplinkPulse } from "./pendingPulse";
import { projectOrbitPosition } from "./projection";
import {
  setShowCommandTraffic,
  setShowCommlinks,
  useFleetCommsToggles,
} from "./toggles";

/**
 * Fleet/Comms: the first-party Phase 1 augment for `SystemView`'s
 * `system-view.overlay`/`system-view.actions`/`system-view.badges` slots
 * (`local_docs/design/specs/2026-07-15-system-view-fleet-comms-design.md`).
 * Scoped to the ACTIVE VESSEL (the Phase 2 all-vessels enrichment is a
 * separate, later spec: see the design doc's "Out of scope"). All three
 * slots the design doc names for this augment are now filled: `.badges` was
 * the last of the three left unregistered (the design doc's own "Fills:"
 * list always named it, "comms/link status indicator") until this pass.
 *
 * Draws:
 * - a comms-path highlight from the vessel to its command centre, styled by
 *   `comms.link`;
 * - a command-traffic overlay: one pulse per `system.uplink.pending` entry,
 *   predicted (never confirmed) from `dispatchedAt`/`oneWaySeconds`;
 * - a compact link-status badge in `SystemView`'s header (`.badges` slot),
 *   the same `comms.link` read the overlay's line colour uses.
 *
 * **Does NOT draw the vessel itself.** `SystemDiagram.tsx`'s own
 * `VesselMarker` already renders the active vessel unconditionally (it needs
 * no augment: see the design doc's 2026-07-16 AMENDMENT: "the fleet is core
 * telemetry ... with no comms Uplink mounted you still see the fleet"). This
 * augment used to draw a SECOND copy of that same marker at the identical
 * projected point (`projectOrbitPosition` mirrors `SystemDiagram`'s private
 * `bodyPosition` exactly, by design, so the two dots always coincided),
 * that duplicate render is the root cause of the live-reported "green dots
 * stacked in the centre" bug: two accent-coloured circles stacked exactly on
 * top of each other, and: because a realistic low-orbit vessel projects only
 * a few px from the origin once the diagram's auto-fit scale is set by a
 * farther-out moon, that stacked pair sits inside the frame body's own dot
 * at the origin. The projected point (`vesselDot` below) is still computed
 * and still used, but purely as an internal anchor for the commlink
 * line/pulses' endpoints, never rendered as its own marker.
 *
 * **Ground/Vantage anchor simplification (Phase 1):** `comms.network`'s nodes
 * carry no positions (design doc grounding), so there is no honest way yet to
 * place an arbitrary `Vantage` (which may not be KSC) on the diagram. This
 * augment anchors the comms-path/command-traffic lines at the diagram's own
 * origin (`overlay.center`, i.e. the frame body): exact when the frame body
 * IS the vessel's home body (the common `frame=auto` case), an approximation
 * otherwise. A faithful multi-hop/arbitrary-Vantage position needs
 * `comms.network` node positions, which is Phase 2 territory (per-vessel +
 * per-authority positional model).
 *
 * **Connectivity rides the delayed `comms.link` MetaTopic** (migrated off
 * the `comms.connectivity` TrueNow bootstrap this augment originally shipped
 * with, per `local_docs/Wednesday Work/2026-07-16-fleetcomms-use-comms-link.md`):
 * `comms.link` is Delayed + freeze-exempt, so a plain `useTelemetry` read
 * puts the path/badge styling in step with the diagram's own delayed vessel
 * dot, the correct edge for "what the operator sees right now" (see
 * `Comms.cs`'s `CommsLink` doc: it is "the ONE client-facing answer" to link
 * state, `comms.connectivity` is its de-publicised TrueNow predecessor).
 * `comms.path` and `system.uplink.pending` stay on `useLatestValue`
 * (TrueNow): they are command-centre dispatch-time bookkeeping, not delayed
 * craft telemetry, exactly the distinction `use-stream.ts`'s own doc draws;
 * only connectivity moved.
 */

const COMMLINK_ACCENT = "var(--color-status-go-fg)";
const COMMLINK_NO_PATH = "var(--color-status-nogo-fg)";
const PULSE_DOT_R = 3.5;

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}
function wrapDegrees360(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}
/** Case/whitespace-insensitive body-name match: mirrors `SystemDiagram`'s own `nameMatches`. */
function frameNameMatches(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

interface WireOrbit {
  sma: Value<"m">;
  ecc: Value<"1">;
  inc: Value<"°">;
  lan?: Value<"°">;
  argPe?: Value<"°">;
  meanAnomalyAtEpoch: Value<"rad">;
  /** An INSTANT the elements are stated at, not a duration. */
  epoch: Value<"ut">;
  mu: Value<"m³/s²">;
  referenceBodyIndex?: number;
}

/**
 * `sitrep-client`'s `OrbitElements` needs radians; the wire is degrees for
 * inc/lan/argPe (KSP-native), `meanAnomalyAtEpoch` already radians. Mirrors
 * `SystemView/index.tsx`'s identical `buildElements`: see this file's own
 * doc comment for why that duplication is deliberate rather than a shared
 * import (the host stays unchanged; this is the established mirror-not-couple
 * pattern for this one small conversion).
 */
function buildElements(o: WireOrbit): OrbitElements {
  return {
    sma: o.sma.magnitude,
    ecc: o.ecc.magnitude,
    inc: degToRad(o.inc.magnitude),
    lan: o.lan == null ? 0 : degToRad(o.lan.magnitude),
    argPe: o.argPe == null ? 0 : degToRad(o.argPe.magnitude),
    meanAnomalyAtEpoch: o.meanAnomalyAtEpoch.magnitude,
    epoch: o.epoch.magnitude,
    mu: o.mu.magnitude,
  };
}

function FleetCommsOverlay({
  width,
  height,
  plotScale,
  center,
  parentName,
}: Readonly<SystemOverlayContext>) {
  // The vessel DOT is a marker: a positive claim about where the craft is now,
  // which `reading.ts` names as the sharpest form of the failure this type
  // prevents. So the elements come from a CURRENT reading, or from a model if
  // one is on offer, and otherwise from nothing: `vesselDot` below returns null
  // and the diagram simply does not draw it, which is the contract
  // `SystemDiagram`'s own marker already follows.
  const orbitReading = useTelemetry("vessel.orbit");
  const orbit =
    orbitReading.state === "observed"
      ? orbitReading.value
      : orbitReading.state === "reckonable"
        ? orbitReading.reckoned.value
        : undefined;
  // An identity and a body catalogue, neither of which decays: a stale SOI index
  // is still which body this craft is around, and a stale catalogue is still the
  // catalogue. Both declared unmodellable.
  const identityReading = useTelemetry("vessel.identity");
  const identity =
    identityReading.state === "observed" || identityReading.state === "stale"
      ? identityReading.value
      : undefined;
  const bodiesReading = useTelemetry("system.bodies");
  const systemBodies =
    bodiesReading.state === "observed" || bodiesReading.state === "stale"
      ? bodiesReading.value
      : undefined;
  const universalTime = useViewUt();

  const { showCommlinks, showCommandTraffic } = useFleetCommsToggles();

  // TrueNow command-centre bookkeeping: see this file's class doc for why
  // these two ride `useLatestValue`/`useUtNow`, not `useTelemetry`/`useViewUt`.
  const commsPath = useLatestValue<CommsPath>("comms.path");
  const pendingQueue = useLatestValue<PendingUplinkQueue>(
    "system.uplink.pending",
  );
  const utNow = useUtNow();
  // Delayed MetaTopic: see this file's class doc for why connectivity alone
  // moved off `useLatestValue`/`comms.connectivity`.
  // Three states that must never collapse into two: connected, NOT connected,
  // and unknown. `comms.link` is declared unmodellable, and a STALE link state
  // is deliberately treated as unknown rather than carried forward, because
  // this one is the exception to "stale is still true": a link is exactly the
  // thing a dropped frame is evidence about, so painting a live commlink from a
  // last-known `connected: true` asserts the one fact the silence contradicts.
  const linkReading = useTelemetry("comms.link");
  const connectivity =
    linkReading.state === "observed" ? linkReading.value : undefined;

  const nameByIndex = useMemo(() => {
    const m = new Map<number, string>();
    for (const b of systemBodies?.bodies ?? []) {
      if (b.name != null) m.set(b.index, b.name);
    }
    return m;
  }, [systemBodies]);

  const vesselBodyName =
    identity?.parentBodyIndex != null
      ? (nameByIndex.get(identity.parentBodyIndex) ?? null)
      : null;

  const trueAnomalyDeg = useMemo(() => {
    if (
      !orbit ||
      universalTime == null ||
      !Number.isFinite(universalTime.magnitude)
    ) {
      return null;
    }
    // Hyperbolic/parabolic guard: `solveAnomalies` throws outside `[0, 1)`
    // eccentricity (an escape/flyby trajectory, routine mid-transfer). Mirrors
    // `SystemView/index.tsx`'s identical guard on the same solver.
    if (!(orbit.ecc.magnitude >= 0 && orbit.ecc.magnitude < 1)) return null;
    const anomalies = solveAnomalies(
      buildElements(orbit),
      universalTime.magnitude,
    );
    const deg = wrapDegrees360(radToDeg(anomalies.trueAnomaly));
    return Number.isFinite(deg) ? deg : null;
  }, [orbit, universalTime]);

  // The active vessel's projected dot: null when off-frame (its SOI body
  // doesn't match the diagram's chosen parent) or the inputs aren't ready
  // yet, same "just don't draw it" contract `SystemDiagram`'s own vessel
  // marker follows.
  const vesselDot = useMemo(() => {
    if (orbit == null || trueAnomalyDeg == null) return null;
    if (
      vesselBodyName == null ||
      !frameNameMatches(vesselBodyName, parentName)
    ) {
      return null;
    }
    return projectOrbitPosition(
      {
        sma: orbit.sma.magnitude,
        ecc: orbit.ecc.magnitude,
        lan: orbit.lan?.magnitude ?? 0,
        argPe: orbit.argPe?.magnitude ?? 0,
        trueAnomalyDeg,
      },
      plotScale,
    );
  }, [orbit, trueAnomalyDeg, vesselBodyName, parentName, plotScale]);

  const halfW = width / 2;
  const halfH = height / 2;

  const linkConnected = connectivity?.connected ?? null;
  const linkColor =
    linkConnected === false ? COMMLINK_NO_PATH : COMMLINK_ACCENT;
  const linkDashed = linkConnected === false;

  const pulses = useMemo(() => {
    if (!vesselDot || utNow == null || !pendingQueue) return [];
    return pendingQueue.pending
      .map((entry) => ({
        entry,
        pulse: computeUplinkPulse(entry, utNow),
      }))
      .filter(
        (
          x,
        ): x is {
          entry: (typeof pendingQueue.pending)[number];
          pulse: NonNullable<ReturnType<typeof computeUplinkPulse>>;
        } => x.pulse !== null,
      );
  }, [pendingQueue, utNow, vesselDot]);

  if (width <= 0 || height <= 0) return null;

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`${-halfW} ${-halfH} ${width} ${height}`}
      role="img"
      aria-label="Fleet and comms overlay"
    >
      {vesselDot && showCommlinks && (
        <line
          x1={center.x}
          y1={center.y}
          x2={vesselDot.x}
          y2={vesselDot.y}
          stroke={linkColor}
          strokeWidth={1.2}
          strokeDasharray={linkDashed ? "3 3" : undefined}
          opacity={linkConnected === false ? 0.6 : 0.85}
          style={{ pointerEvents: "auto" }}
        >
          <title>
            {describeCommsPath(commsPath)}
            {linkConnected === false ? " (no link)" : ""}
          </title>
        </line>
      )}

      {vesselDot && showCommandTraffic && (
        <g pointerEvents="none">
          {pulses.map(({ entry, pulse }) => {
            const from = pulse.leg === "outbound" ? center : vesselDot;
            const to = pulse.leg === "outbound" ? vesselDot : center;
            const x = from.x + (to.x - from.x) * pulse.progress;
            const y = from.y + (to.y - from.y) * pulse.progress;
            return (
              <circle
                key={entry.id}
                cx={x}
                cy={y}
                r={PULSE_DOT_R}
                fill="url(#fleet-comms-pulse-gradient)"
                opacity={pulse.opacity}
              />
            );
          })}
        </g>
      )}

      {pulses.length > 0 && (
        <defs>
          <radialGradient id="fleet-comms-pulse-gradient">
            <stop offset="0%" stopColor="var(--color-text-primary)" />
            <stop
              offset="100%"
              stopColor="var(--color-text-primary)"
              stopOpacity={0}
            />
          </radialGradient>
        </defs>
      )}
    </svg>
  );
}

function FleetCommsActions() {
  const { showCommlinks, showCommandTraffic } = useFleetCommsToggles();
  return (
    <Cluster justify="start" gap="xs">
      <ToggleButton
        type="button"
        size="sm"
        active={showCommlinks}
        title="Show commlinks"
        onClick={() => setShowCommlinks(!showCommlinks)}
      >
        Commlinks
      </ToggleButton>
      <ToggleButton
        type="button"
        size="sm"
        active={showCommandTraffic}
        title="Show command traffic"
        onClick={() => setShowCommandTraffic(!showCommandTraffic)}
      >
        Traffic
      </ToggleButton>
    </Cluster>
  );
}

/**
 * `system-view.badges`: a compact link-status indicator, the design doc's
 * "comms/link status indicator" fill this augment always intended (see this
 * file's class doc) but never registered until now. Reads the exact same
 * `comms.link` topic the overlay's commlink line colour derives from, so the
 * header badge and the diagram line can never disagree.
 *
 * Three states, never collapsed into each other: `connected` (a real link
 * home right now), `no link` (a real, confirmed absence: a genuine ops
 * fact), and `NULL_DISPLAY` (`comms.link` has never delivered a sample: no
 * Uplink mounted, or nothing received yet: an honest "unknown", not a
 * fabricated "no link"). Ignores `frameName`: link state isn't a function of
 * which body the diagram is framed on.
 */
function FleetCommsBadge(_props: Readonly<SystemBadgesContext>) {
  const linkReading = useTelemetry("comms.link");
  // Same rule as the diagram's own read above, and the same reason: a stale
  // link reads as UNKNOWN (`null`), never as its last value, because silence is
  // evidence about a link in a way it is not about an altitude. `null` is
  // already this badge's honest-unknown state, so nothing else changes.
  const connected =
    linkReading.state === "observed"
      ? (linkReading.value.connected ?? null)
      : null;
  // `Badge` (ui-kit): the codebase's one canonical state-pill, already
  // carrying the vetted go/nogo/neutral fg-on-bg contrast pairing, so this
  // badge composes it rather than hand-rolling a styled dot (the widget
  // library's own convention: no bespoke CSS where a ui-kit primitive
  // already fits, see local_docs/telemetry-mod/ui-kit-design.md). The label
  // text IS the accessible name; no `aria-label` needed on top of it.
  const severity: Severity | undefined =
    connected === true
      ? "nominal"
      : connected === false
        ? "critical"
        : undefined;
  const label =
    connected === true ? "LINK" : connected === false ? "NO LINK" : null;
  // `data-testid`: the label text alone isn't a safe query target for the
  // unknown state (`NULL_DISPLAY`, the shared null-placeholder glyph, also
  // appears elsewhere in the diagram/almanac), so tests scope to this
  // instead of risking an ambiguous `getByText` match, per the KCD
  // role>label>text>testid fallback order.
  return (
    <Badge severity={severity} data-testid="fleet-comms-badge">
      {label ?? NULL_DISPLAY}
    </Badge>
  );
}

// ── Registration ──────────────────────────────────────────────────────────────

registerAugment({
  id: "fleet-comms-overlay",
  augments: "system-view.overlay",
  component: FleetCommsOverlay,
  channels: [
    "vessel.orbit",
    "vessel.identity",
    "system.bodies",
    "comms.path",
    "comms.link",
    "system.uplink.pending",
  ],
});

registerAugment({
  id: "fleet-comms-actions",
  augments: "system-view.actions",
  component: FleetCommsActions,
});

registerAugment({
  id: "fleet-comms-badge",
  augments: "system-view.badges",
  component: FleetCommsBadge,
  channels: ["comms.link"],
});

export { FleetCommsActions, FleetCommsBadge, FleetCommsOverlay };
