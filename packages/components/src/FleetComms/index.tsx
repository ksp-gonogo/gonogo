import { registerAugment, useTelemetry } from "@ksp-gonogo/core";
import {
  type OrbitElements,
  solveAnomalies,
  useLatestValue,
  useUtNow,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import type {
  CommsConnectivity,
  CommsPath,
  PendingUplinkQueue,
} from "@ksp-gonogo/sitrep-sdk";
import { ToggleButton } from "@ksp-gonogo/ui";
import { Cluster } from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import type { SystemOverlayContext } from "../SystemView";
import { describeCommsPath } from "./commsPathSummary";
import { computeUplinkPulse } from "./pendingPulse";
import { projectOrbitPosition } from "./projection";
import {
  setShowCommandTraffic,
  setShowCommlinks,
  useFleetCommsToggles,
} from "./toggles";

/**
 * Fleet/Comms — the first-party Phase 1 augment for `SystemView`'s
 * `system-view.overlay`/`system-view.actions` slots
 * (`docs/superpowers/specs/2026-07-15-system-view-fleet-comms-design.md`).
 * Scoped to the ACTIVE VESSEL (the Phase 2 all-vessels enrichment is a
 * separate, later spec — see the design doc's "Out of scope").
 *
 * Draws:
 * - a comms-path highlight from the vessel to its command centre, styled by
 *   `comms.connectivity`;
 * - a command-traffic overlay: one pulse per `system.uplink.pending` entry,
 *   predicted (never confirmed) from `dispatchedAt`/`oneWaySeconds`.
 *
 * **Does NOT draw the vessel itself.** `SystemDiagram.tsx`'s own
 * `VesselMarker` already renders the active vessel unconditionally (it needs
 * no augment — see the design doc's 2026-07-16 AMENDMENT: "the fleet is core
 * telemetry ... with no comms Uplink mounted you still see the fleet"). This
 * augment used to draw a SECOND copy of that same marker at the identical
 * projected point (`projectOrbitPosition` mirrors `SystemDiagram`'s private
 * `bodyPosition` exactly, by design, so the two dots always coincided) —
 * that duplicate render is the root cause of the live-reported "green dots
 * stacked in the centre" bug: two accent-coloured circles stacked exactly on
 * top of each other, and — because a realistic low-orbit vessel projects only
 * a few px from the origin once the diagram's auto-fit scale is set by a
 * farther-out moon — that stacked pair sits inside the frame body's own dot
 * at the origin. The projected point (`vesselDot` below) is still computed
 * and still used, but purely as an internal anchor for the commlink
 * line/pulses' endpoints, never rendered as its own marker.
 *
 * **Ground/Vantage anchor simplification (Phase 1):** `comms.network`'s nodes
 * carry no positions (design doc grounding), so there is no honest way yet to
 * place an arbitrary `Vantage` (which may not be KSC) on the diagram. This
 * augment anchors the comms-path/command-traffic lines at the diagram's own
 * origin (`overlay.center`, i.e. the frame body) — exact when the frame body
 * IS the vessel's home body (the common `frame=auto` case), an approximation
 * otherwise. A faithful multi-hop/arbitrary-Vantage position needs
 * `comms.network` node positions, which is Phase 2 territory (per-vessel +
 * per-authority positional model).
 *
 * **TrueNow bootstrap (Phase 1, flagged in the design doc):** `comms.path`/
 * `comms.network`/`comms.connectivity` are TrueNow on the wire today (the
 * Delayed reclassification described in the design doc's grounding section
 * lives on the not-yet-merged `ww/comms-terminal` work, which also renames
 * connectivity to `comms.link`). Until that lands, this augment reads
 * `comms.connectivity` via `useLatestValue` — the correct hook for a TrueNow
 * command-centre topic (see `use-stream.ts`'s own doc: sampling a TrueNow
 * topic through the delayed frame `useTelemetry`/`useStream` read makes it
 * appear a whole one-way-delay late) — matching `KosTerminal`'s already-
 * shipped in-transit strip, which reads the exact same three topics the
 * exact same way. Swap to `comms.link` + a Delayed read once that work merges.
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
/** Case/whitespace-insensitive body-name match — mirrors `SystemDiagram`'s own `nameMatches`. */
function frameNameMatches(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

interface WireOrbit {
  sma: number;
  ecc: number;
  inc: number;
  lan?: number;
  argPe?: number;
  meanAnomalyAtEpoch: number;
  epoch: number;
  mu: number;
  referenceBodyIndex?: number;
}

/**
 * `sitrep-client`'s `OrbitElements` needs radians; the wire is degrees for
 * inc/lan/argPe (KSP-native), `meanAnomalyAtEpoch` already radians. Mirrors
 * `SystemView/index.tsx`'s identical `buildElements` — see this file's own
 * doc comment for why that duplication is deliberate rather than a shared
 * import (the host stays unchanged; this is the established mirror-not-couple
 * pattern for this one small conversion).
 */
function buildElements(o: WireOrbit): OrbitElements {
  return {
    sma: o.sma,
    ecc: o.ecc,
    inc: degToRad(o.inc),
    lan: o.lan == null ? 0 : degToRad(o.lan),
    argPe: o.argPe == null ? 0 : degToRad(o.argPe),
    meanAnomalyAtEpoch: o.meanAnomalyAtEpoch,
    epoch: o.epoch,
    mu: o.mu,
  };
}

function FleetCommsOverlay({
  width,
  height,
  plotScale,
  center,
  parentName,
}: Readonly<SystemOverlayContext>) {
  const orbit = useTelemetry("vessel.orbit");
  const identity = useTelemetry("vessel.identity");
  const systemBodies = useTelemetry("system.bodies");
  const universalTime = useViewUt();

  const { showCommlinks, showCommandTraffic } = useFleetCommsToggles();

  // TrueNow command-centre bookkeeping — see this file's class doc for why
  // these three ride `useLatestValue`/`useUtNow`, not `useTelemetry`/`useViewUt`.
  const commsPath = useLatestValue<CommsPath>("comms.path");
  const connectivity = useLatestValue<CommsConnectivity>("comms.connectivity");
  const pendingQueue = useLatestValue<PendingUplinkQueue>(
    "system.uplink.pending",
  );
  const utNow = useUtNow();

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
    if (!orbit || universalTime == null || !Number.isFinite(universalTime)) {
      return null;
    }
    // Hyperbolic/parabolic guard — `solveAnomalies` throws outside `[0, 1)`
    // eccentricity (an escape/flyby trajectory, routine mid-transfer). Mirrors
    // `SystemView/index.tsx`'s identical guard on the same solver.
    if (!(orbit.ecc >= 0 && orbit.ecc < 1)) return null;
    const anomalies = solveAnomalies(buildElements(orbit), universalTime);
    const deg = wrapDegrees360(radToDeg(anomalies.trueAnomaly));
    return Number.isFinite(deg) ? deg : null;
  }, [orbit, universalTime]);

  // The active vessel's projected dot — null when off-frame (its SOI body
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
        sma: orbit.sma,
        ecc: orbit.ecc,
        lan: orbit.lan ?? 0,
        argPe: orbit.argPe ?? 0,
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
    "comms.connectivity",
    "system.uplink.pending",
  ],
});

registerAugment({
  id: "fleet-comms-actions",
  augments: "system-view.actions",
  component: FleetCommsActions,
});

export { FleetCommsActions, FleetCommsOverlay };
