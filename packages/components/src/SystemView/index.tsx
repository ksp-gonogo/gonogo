import type {
  ComponentProps,
  ConfigComponentProps,
  OrbitPatch,
} from "@ksp-gonogo/core";
import {
  AugmentSlot,
  registerComponent,
  useContributions,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  CELESTIAL_FACTS,
  type CelestialFacts,
  canPropagate,
  type OrbitElements,
  type OrbitTrajectory,
  type OrbitTrajectoryInput,
  solveAnomalies,
  useFleetVesselSilence,
  useLatestValue,
  useOrbitTrajectory,
  useProcessor,
  useUtNow,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import type { PendingUplinkQueue, Value } from "@ksp-gonogo/sitrep-sdk";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Panel,
  Select,
  useElementSize,
  useModalSaveBar,
} from "@ksp-gonogo/ui";
import { FramedDisplay, NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
// FleetComms's `.actions` slot (Commlinks/Traffic toggles) now gates THIS
// host's own shape-contribution render, not a second overlay draw:
// reconciled the old straight-line comms overlay onto the graph/highlight/
// pulse model built in Tasks 4-6, so the toggles moved with it. A pure
// module-scoped store (no augment-only state), safe to read directly.
import { useFleetCommsToggles } from "../FleetComms/toggles";
import { quantiseUt } from "../MapView/predictionThrottle";
import { TrajectoryFrameCaption } from "../shared/trajectoryFrame";
import { TrajectoryWithheldNote } from "../shared/trajectoryWithheld";
import { AlmanacPanel } from "./AlmanacPanel";
import {
  COMMS_PATH_COLOUR,
  commsControlQuality,
  deriveCommsPath,
  NO_COMMS_PATH,
} from "./commsPath";
import { deriveTraffic, NO_TRAFFIC } from "./commsTraffic";
import { resolveProjection } from "./projection";
// Side-effect import: the host's own entries on `system-view.projection`, so the
// picker, the filter and the resolver are all travelled on a bare stock install
// with no Uplinks at all.
import "./projectionContribution";
import { SystemDiagram, vesselPlotStateFromStatus } from "./SystemDiagram";
import { SystemEntitiesLayer } from "./SystemEntitiesLayer";
import type { SystemEntityStyle } from "./systemEntities";
// Side-effect import: the built-in vessel-orbits contribution self-registers
// against `system-view.entities` on module load (same pattern as ShipMap's
// `./partMetersContribution`).
import "./vesselOrbitsContribution";
import {
  angleDelta,
  hohmannPhaseAngle,
  type TransferStatus,
  transferStatus,
} from "./transferWindow";
import { type CelestialBody, useCelestialBodies } from "./useCelestialBodies";
import { usePhaseAngles } from "./usePhaseAngles";
import { VesselInfoPanel } from "./VesselInfoPanel";
// Side-effect import: registers the `system-view.vessel-status` built-in
// contribution (the comms-derived silence reckoning for the plotted
// vessel), on equal footing with any third-party Uplink contribution to the
// same slot.
import "./vesselStatusContribution";
import type { SystemViewVesselStatusEntry } from "./vesselStatusContribution";

interface SystemViewConfig {
  /**
   * Body to render the diagram around. "auto" follows the vessel's
   * current body (`v.body`) so a Kerbin-launch shows Mun/Minmus and a
   * Mun-orbit shows Mun's neighbourhood. "root" walks up to the topmost
   * parent (Kerbol from anywhere in the Kerbin system). An explicit body
   * name pins the frame regardless of vessel state.
   */
  frame?: "auto" | "root" | string;
  /**
   * Which frame the WHOLE picture is drawn in: the bodies, their rings, the
   * craft and its curve alike. The id of an entry on `system-view.projection`.
   *
   * <b>This replaced a `readFrame` option that reframed the craft's curve
   * only.</b> That option's own label promised to hold the parent still and it
   * held nothing still: `readFrame` reached `useOrbitTrajectory` and appeared
   * nowhere in the diagram, so every body stayed in parent-centred inertial
   * coordinates while the curve became a rosette, and the picture had two frames
   * in it. The two are the same concept at two scopes and the smaller scope was
   * the incoherent one.
   *
   * Absent means the inertial entry for whichever body the diagram is centred on,
   * which is the picture this widget always drew.
   */
  projection?: string;
}

// ── Augment slots (Uplink architecture) ─────────────────────────────────────────
// SystemView is a HOST that exposes three slots; no first-party augment fills them
// here, so each renders nothing until an Uplink registers.
// The `.actions` + `.overlay` pair is designed to be driven by ONE coordinated
// augment: e.g. a "show commlinks" toggle contributed into `.actions` drives a
// commlink overlay contributed into `.overlay`, sharing state through the
// augment's OWN context: no cross-Uplink coupling, the host only exposes the
// two extension points.

/**
 * Props for `system-view.overlay`: an OVERLAY slot, rendered in
 * a layer absolutely positioned over the solar-system body diagram. The diagram
 * draws parent-centric in SVG user-units: the frame body sits at `center` (the
 * SVG origin) and a distance of `d` metres from it projects to `d · plotScale`
 * user-units, over a `width`×`height` px, origin-centred viewBox. An overlay
 * augment: e.g. a future RealAntennas relay-network / range-ring visualiser,
 * builds a matching viewBox / transform from these to draw in the diagram's
 * coordinate space. The projection describes the diagram's auto-fit view (zoom=1,
 * no pan); live pan/zoom is internal to `SystemDiagram` and not reflected here,
 * matching `orbit-view.overlay`'s static-projection contract.
 */
export interface SystemOverlayContext {
  /** Name of the parent body the diagram is centred on. */
  parentName: string;
  /** Diagram pixel width (origin-centred SVG frame). */
  width: number;
  /** Diagram pixel height. */
  height: number;
  /** Metres → SVG-user-unit plot scale at the diagram's auto-fit zoom. */
  plotScale: number;
  /** The parent body sits at the SVG origin. */
  center: { x: number; y: number };
}

// Co-located declaration-merge of this widget's slot ids → their props. Kept
// next to the widget (not in a central registry file) so parallel slot work
// on other widgets never collides on this seam.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    // Rendered by `Panel`'s universal `actions` segment, not by this widget:
    // the id is declared here only so a binder's component still types against
    // the propless contract rather than the loose fallback.
    "system-view.actions": Record<string, never>;
    "system-view.overlay": SystemOverlayContext;
  }

  /**
   * `system-view.vessel-status`: the plotted vessel's node decoration, fed
   * by the built-in comms-derived contribution
   * (`./vesselStatusContribution.ts`) and open to any other Uplink
   * contributing SEMANTIC status for the same vessel (severity/emphasis/
   * label/tooltip, never a colour: the host owns the palette, see
   * `SystemDiagram.vesselPlotStateFromStatus`).
   */
  interface ContributionRegistry {
    "system-view.vessel-status": {
      entry: SystemViewVesselStatusEntry;
      topics: "vessel.identity";
    };
  }
}

/** Auto-fit padding: mirrors `SystemDiagram`'s own `PAD` so the overlay
 * projection matches the diagram's metres → px scale. */
const DIAGRAM_PAD = 20;

/** Case/whitespace-insensitive body-name match: mirrors `SystemDiagram`'s
 * `nameMatches`, used to decide whether the vessel's orbit contributes to the
 * overlay's auto-fit extent. */
function frameNameMatches(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// ── Client-side orbit derivations ───────────────────────────────────────────────
// Mirror `@ksp-gonogo/sitrep-client`'s `deriveVesselState` (vessel-state.ts) so the
// widget reconstructs its orbital scalars (trueAnomaly / next-apsis /
// encounter) directly from the streamed
// `vessel.orbit` elements + the SDK view-UT, derived client-side.
// `vessel.orbit`'s angles are DEGREES on the wire (KSP-native), while
// `kepler`'s `OrbitElements` is all-radians, so this is the one place the mix is
// normalised (meanAnomalyAtEpoch is already radians, the documented KSP quirk).

/** `Sitrep.Contract.TransitionType` ordinals the encounter chip surfaces. */
const TRANSITION_TYPE_ENCOUNTER = 2;
const TRANSITION_TYPE_ESCAPE = 3;

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

function finiteOrNull(x: number): number | null {
  return Number.isFinite(x) ? x : null;
}

/**
 * The subset of `vessel.orbit` the solver needs, as it arrives on the wire.
 *
 * Structural rather than the contract type so the shape stays visible at a
 * glance: this is the six elements plus mu, and nothing else on `VesselOrbit`
 * has any business reaching `solveAnomalies`.
 */
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
}

/**
 * Where the elements stop being quantities and start being solver inputs.
 *
 * `OrbitElements` is radians throughout, which is the conversion this function
 * has always existed to do. The magnitudes come off in the same step, so the
 * solver keeps its one plain-number contract and the degrees-to-radians turn
 * still happens in exactly one place.
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

/**
 * Seconds from `meanAnomaly` (rad) until it next reaches `target` (rad), wrapped
 * forward to `[0, period)`. `null` for a non-positive/non-finite mean motion.
 */
function timeToMeanAnomaly(
  meanAnomaly: number,
  target: number,
  meanMotion: number,
): number | null {
  if (
    !Number.isFinite(meanAnomaly) ||
    !Number.isFinite(meanMotion) ||
    meanMotion <= 0
  ) {
    return null;
  }
  const twoPi = 2 * Math.PI;
  let delta = (target - meanAnomaly) % twoPi;
  if (delta < 0) delta += twoPi;
  return delta / meanMotion;
}

/** Whichever of `timeToAp`/`timeToPe` is the smaller non-null countdown. */
function nextApsisOf(
  timeToAp: number | null,
  timeToPe: number | null,
): { nextApsisType: number | null; timeToNextApsis: number | null } {
  if (timeToAp != null && (timeToPe == null || timeToAp <= timeToPe)) {
    return { nextApsisType: 1, timeToNextApsis: timeToAp };
  }
  if (timeToPe != null) {
    return { nextApsisType: -1, timeToNextApsis: timeToPe };
  }
  return { nextApsisType: null, timeToNextApsis: null };
}

/**
 * What the diagram is telling the operator about a craft it cannot see,
 * rendered straight from `system-view.vessel-status`'s contributed entry:
 * SystemView never interprets silence state itself, it only decides the
 * ANNOUNCEMENT POLICY (which severities interrupt) for whatever a
 * contributor said.
 *
 * Announcement is scoped to what each severity warrants. `critical` is
 * assertive (`role="alert"`): the decision has been made and it should cut
 * through. `warning` is polite (`role="status"`): the craft is late, there
 * is still time for it, and interrupting would overstate the case. `info`
 * (an expected-reacquisition countdown, or plain silence) is announced by
 * NEITHER, because a countdown changes every tick and a live region would
 * read it aloud indefinitely.
 */
function ContactCaption({
  status,
  vesselName,
}: Readonly<{
  status: SystemViewVesselStatusEntry | undefined;
  vesselName: string;
}>) {
  if (!status) return null;

  if (status.severity === "critical") {
    return (
      <div style={FRAME_CAPTION} role="alert" aria-live="assertive">
        <span style={{ textDecoration: "line-through" }}>{vesselName}</span>{" "}
        {status.label.toLowerCase()}
      </div>
    );
  }

  if (status.severity === "warning") {
    return (
      <div style={FRAME_CAPTION} role="status" aria-live="polite">
        {vesselName} {status.label.toLowerCase()}
      </div>
    );
  }

  return (
    <div style={FRAME_CAPTION}>
      {vesselName} {status.label.toLowerCase()}
    </div>
  );
}

function SystemViewComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<SystemViewConfig>>) {
  const frameSetting = config?.frame ?? "auto";
  const bodies = useCelestialBodies();
  // The same catalogue the list above comes from, kept whole because a read
  // frame needs the index lookups and the parent links, not just the bodies.
  const facts = useProcessor(CELESTIAL_FACTS);
  // Streamed Topics: raw `vessel.*` records read straight off the Uplink
  // store via the canonical `useTelemetry(TopicId)` hook: no legacy
  // `DataSource` fallback. The scalars the widget used to read off
  // trueAnomaly / next-apsis / encounter are reconstructed client-side below
  // from `vessel.orbit`'s elements + the SDK view-UT.
  // The vessel's dot and its drawn orbit are MARKERS: positive claims about
  // where the craft is now. So the elements come from a CURRENT reading, or from
  // a model if one is on offer, and otherwise from nothing at all, and the
  // "just don't draw it" contract this diagram's own marker already follows
  // takes over. Same decision as MapView and FleetComms, for the same reason.
  const orbitReading = useTelemetry("vessel.orbit");
  const orbit =
    orbitReading.state === "observed"
      ? orbitReading.value
      : orbitReading.state === "reckonable"
        ? orbitReading.reckoned.value
        : undefined;
  // An identity does not decay: a stale SOI index is still which body this craft
  // is around, and it only decides which FRAME the dot belongs in.
  const identityReading = useTelemetry("vessel.identity");
  const identity =
    identityReading.state === "observed" || identityReading.state === "stale"
      ? identityReading.value
      : undefined;

  // Contact state for the plotted craft. `connected` is core (this widget
  // has no need of it directly); the reckoned states (predicted/overdue/
  // lost) arrive as `system-view.vessel-status` contributions instead of a
  // direct sitrep-client import, so the diagram never hard-codes the comms
  // model. `useFleetVesselSilence` still has to run somewhere so the
  // per-vessel `silence.<guid>.state` topic stays subscribed (a genuinely
  // dynamic topic no contribution's static deps can name), and mirrors what
  // it reads into the bridge `system-view-vessel-silence-status` reads from;
  // SystemView keeps this ONE raw subscription, but never interprets the
  // value itself. `fleet.<guid>.contact`/`silence.<guid>.state` are both
  // freeze-EXEMPT in the engine precisely so they keep reporting while the
  // craft is dark, which is the only reason a diagram can say anything at
  // all about a vessel it has lost.
  const vesselGuid =
    typeof identity?.vesselId === "string" ? identity.vesselId : null;
  useFleetVesselSilence(vesselGuid ?? "");
  const vesselStatuses = useContributions("system-view.vessel-status");
  const vesselStatus = vesselGuid
    ? vesselStatuses.find((s) => s.target === vesselGuid)
    : undefined;
  const vesselPlotState = vesselPlotStateFromStatus(vesselStatus ?? null);
  // A catalogue and a name, neither of which decays.
  const bodiesReading = useTelemetry("system.bodies");
  const systemBodies =
    bodiesReading.state === "observed" || bodiesReading.state === "stale"
      ? bodiesReading.value
      : undefined;
  const targetReading = useTelemetry("vessel.target");
  const targetName =
    targetReading.state === "observed" || targetReading.state === "stale"
      ? targetReading.value.name
      : undefined;
  // Raw CommNet graph, read directly rather than through the contribution:
  // the selection highlight walks it host-side to derive the SELECTED
  // vessel's route home, a generic traversal over the same topic
  // `vesselOrbitsContribution.ts` already draws as faint connection lines.
  // A relay graph does not decay into meaninglessness, so a stale one still
  // says what the topology last was, which is what the faint lines already
  // assert.
  const commsNetworkReading = useTelemetry("comms.network");
  const commsNetwork =
    commsNetworkReading.state === "observed" ||
    commsNetworkReading.state === "stale"
      ? commsNetworkReading.value
      : undefined;
  // View-UT: the SDK view time the propagation already evaluates at
  // (`t.universalTime` was never a stream; it IS `sdk.view.ut()`).
  // `.magnitude` at the read. Everything below is geometry on a bare UT, and two
  // guards further down test it with `Number.isFinite` and `typeof === "number"`,
  // which both answer NO for a wrapped value and would silently stop drawing the
  // arc with no type error at all.
  const universalTime = useViewUt()?.magnitude;
  // Command traffic: TrueNow command-centre bookkeeping, same
  // `useLatestValue`/`useUtNow` split `FleetComms` already rides for this
  // exact topic (see that widget's class doc for why: dispatch-time facts,
  // not delayed craft telemetry).
  const pendingQueue = useLatestValue<PendingUplinkQueue>(
    "system.uplink.pending",
  );
  const utNow = useUtNow();
  // FleetComms's Commlinks/Traffic toggles: they used
  // to gate that augment's own straight-line overlay draw; now they gate the
  // relay-graph `connection-line` entities and the command-traffic pulses
  // below, the shapes that superseded it.
  const { showCommlinks, showCommandTraffic } = useFleetCommsToggles();

  // Shape-contribution foundation: every `system-view.entities` contribution
  // (vessel orbits, the CommNet graph, a future CME front, ...), aggregated
  // and z-ordered by `SystemEntitiesLayer`, projected through the SAME
  // auto-fit `overlayContext` an overlay augment already draws against
  // (built further down). SystemView owns the one piece of dynamic state a
  // contribution can't: which entity, if any, is selected.
  const rawEntities = useContributions("system-view.entities");
  // Suppress the active/framed vessel's own entry, but only while
  // `SystemDiagram` actually has a dedicated bright ring to draw in its
  // place: that ring comes from `vessel.orbit` (`vesselOrbit` below), a
  // separate topic from `vessel.identity`. Gating on identity alone used to
  // strand a hop endpoint with no marker at all whenever a caller carried
  // identity (needed so command traffic, further down, knows which vessel
  // it's routing to) without also carrying orbit: neither the dedicated ring
  // nor the contributed faint one rendered. Host state, not contribution
  // data: matched by `vesselId`, not by parsing a contribution-private `id`
  // string.
  //
  // `showCommlinks` off drops every `connection-line` entity (the CommNet
  // relay graph, `vesselOrbitsContribution.ts`'s `comms-edge:*` entries, and
  // with them the selected-path highlight, since that's the SAME line
  // decorated bright rather than a separate shape): the Commlinks toggle's
  // new home.
  const entities = useMemo(() => {
    const withoutActiveVessel =
      identity?.vesselId != null && orbit != null
        ? rawEntities.filter((e) => e.vesselId !== identity.vesselId)
        : rawEntities;
    return showCommlinks
      ? withoutActiveVessel
      : withoutActiveVessel.filter((e) => e.shape.kind !== "connection-line");
  }, [rawEntities, identity?.vesselId, orbit, showCommlinks]);
  // `selectedVesselId` is keyed by the ACTIVATED ENTITY's own `id` (e.g.
  // `vessel-orbit:<vesselId>`), not the bare vesselId: that's what the
  // click/keyboard handler on `SystemEntitiesLayer` reports, and it's also
  // exactly what `decorate` needs to match below. The selected entity's own
  // `vesselId` field (read back via `selectedEntity`) is what CommNet path
  // derivation needs instead, since a graph node's id IS a vessel's
  // `vesselId`, not the contribution's own entity id string.
  const [selectedVesselId, setSelectedVesselId] = useState<string | null>(null);
  const handleEntityActivate = useCallback((id: string) => {
    setSelectedVesselId((prev) => (prev === id ? null : id));
  }, []);
  const handleDeselect = useCallback(() => setSelectedVesselId(null), []);
  // Escape-to-deselect: a DOCUMENT-level listener (same idiom as
  // ActionMenu.tsx's outside-pointer dismiss), not a keydown handler on the
  // diagram's own container, since that container is a plain layout `<div>`
  // with no interactive role of its own (`noStaticElementInteractions`).
  // Only live while something is actually selected, so it never intercepts
  // Escape elsewhere on the dashboard.
  useEffect(() => {
    if (selectedVesselId === null) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") handleDeselect();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedVesselId, handleDeselect]);
  const selectedEntity = useMemo(
    () => entities.find((e) => e.id === selectedVesselId) ?? null,
    [entities, selectedVesselId],
  );
  // The selected vessel's CommNet route to home,
  // a generic BFS over `comms.network`'s already-contributed graph (no
  // per-vessel path ships on the wire). Falls back to `NO_COMMS_PATH` when
  // nothing is selected or the selected entity carries no `vesselId` (e.g.
  // a hypothetical future non-vessel selectable entity).
  const commsPath = useMemo(
    () =>
      selectedEntity?.vesselId != null
        ? deriveCommsPath(commsNetwork, selectedEntity.vesselId)
        : NO_COMMS_PATH,
    [commsNetwork, selectedEntity],
  );
  const commsPathEdgeIds = useMemo(
    () => new Set(commsPath.edgeIds),
    [commsPath],
  );
  // The highlighted path's colour: the SELECTED VESSEL'S own roster comms
  // control state (`meta.comms`, the same label the info panel shows), not
  // `commsPath.quality` (that field governs traversal only, see
  // `commsPath.ts`'s module doc comment). Keeps the line's colour in
  // agreement with the info panel's "Comms: ..." row even when the BFS
  // happened to find an all-active edge chain through another vessel's
  // relay.
  const commsPathColour = useMemo(
    () => COMMS_PATH_COLOUR[commsControlQuality(selectedEntity?.meta?.comms)],
    [selectedEntity],
  );
  // Command traffic: `system.uplink.pending` has no vessel-target
  // field (a hard contract invariant, see `commsTraffic.ts`'s module doc), so
  // every pending entry is implicitly addressed to the ACTIVE vessel, routed
  // over the SAME `comms.network` graph the selection path above walks.
  // Independent of selection: traffic keeps animating on the active vessel's
  // route whether or not the operator has anything else selected.
  //
  // `showCommandTraffic` off (the Traffic toggle's new home)
  // short-circuits straight to `NO_TRAFFIC` rather than deriving then
  // discarding: same "don't do the work if nothing will render" discipline
  // `entities`' own `showCommlinks` filter follows above.
  const traffic = useMemo(
    () =>
      showCommandTraffic
        ? deriveTraffic(
            pendingQueue?.pending ?? [],
            commsNetwork,
            identity?.vesselId,
            utNow,
          )
        : NO_TRAFFIC,
    [pendingQueue, commsNetwork, identity?.vesselId, utNow, showCommandTraffic],
  );
  // The id-keyed decoration hook: brightens the selected vessel's own
  // orbit/point entity (faint -> bright, no colour override needed, the
  // `bright` emphasis token already reads prominent) and colours the derived
  // CommNet path's edges by the selected vessel's control state. Command
  // traffic deliberately does NOT decorate the edge itself: the moving
  // gradient pulse (`SystemEntitiesLayer`'s `pulses` prop, below) is the
  // sole traffic indicator, riding a plain grey/white CommNet line, so an
  // ambient "this route carries traffic" wash never sits underneath and
  // dilutes the travelling glow into an always-bright line. Never touches
  // the contribution's data, purely a style override keyed by id.
  const decorate = useCallback(
    (id: string): SystemEntityStyle | undefined => {
      if (id === selectedVesselId) return { emphasis: "bright" };
      if (commsPathEdgeIds.has(id)) {
        return { emphasis: "bright", colour: commsPathColour };
      }
      return undefined;
    },
    [selectedVesselId, commsPathEdgeIds, commsPathColour],
  );

  // Stable body-index → NAME map (from `system.bodies`' stable `index`, never
  // array position): the display-map behind `v.body` / `o.encounterBody`.
  const nameByIndex = useMemo(() => {
    const m = new Map<number, string>();
    for (const b of systemBodies?.bodies ?? []) {
      if (b.name != null) m.set(b.index, b.name);
    }
    return m;
  }, [systemBodies]);

  // Vessel's current body NAME: parentBodyIndex resolved against
  // `system.bodies`.
  const vesselBody =
    identity?.parentBodyIndex != null
      ? (nameByIndex.get(identity.parentBodyIndex) ?? null)
      : null;

  // Client-derived orbital scalars at view-UT (mirrors deriveVesselState:
  // trueAnomaly for the vessel dot, period, and the next-apsis countdown).
  const derived = useMemo(() => {
    if (!orbit || universalTime == null || !Number.isFinite(universalTime)) {
      return null;
    }
    // `solveAnomalies` throws a RangeError for parabolic/hyperbolic orbits
    // (ecc outside `[0, 1)`: escape/flyby trajectories, a routine state for a
    // system-wide diagram during interplanetary transfers). Degrade the
    // orbital scalars to null rather than crashing the whole widget mid-render
    // (there's no error boundary inside it, and these used to arrive as plain
    // wire scalars that never threw). Guard
    // exactly the solver's own throw condition (`ecc < 0 || ecc >= 1`); the
    // sibling `orbitPatches` memo already gates the same `ecc < 1` boundary.
    if (!(!orbit.ecc.isNegative() && orbit.ecc.lessThan(1))) {
      return null;
    }
    // Ask the provider before extrapolating. The window is the VIEW instant on
    // both ends, deliberately: the horizon is an absolute UT bound, so "can you
    // answer for this instant" is the whole question, and building a window from
    // `orbit.epoch` would be wrong in a way no type could catch (`epoch` is the
    // mean-anomaly reference, not when the sample was taken).
    //
    // Permits everything while the elected provider is the analytic solver. It
    // starts refusing when one that integrates is elected; see `canPropagate`.
    if (
      !canPropagate(orbit.horizon, universalTime, universalTime).propagatable
    ) {
      return null;
    }
    const elements = buildElements(orbit);
    const anomalies = solveAnomalies(elements, universalTime);
    const trueAnomaly = finiteOrNull(
      wrapDegrees360(radToDeg(anomalies.trueAnomaly)),
    );
    const period = finiteOrNull((2 * Math.PI) / anomalies.meanMotion);
    const timeToAp = timeToMeanAnomaly(
      anomalies.meanAnomaly,
      Math.PI,
      anomalies.meanMotion,
    );
    const timeToPe = timeToMeanAnomaly(
      anomalies.meanAnomaly,
      0,
      anomalies.meanMotion,
    );
    return { trueAnomaly, period, ...nextApsisOf(timeToAp, timeToPe) };
  }, [orbit, universalTime]);

  // Next SOI transition, from the streamed `vessel.orbit.encounter` record.
  const encounter = orbit?.encounter ?? null;
  const encounterExists =
    encounter?.transitionType === TRANSITION_TYPE_ENCOUNTER
      ? 1
      : encounter?.transitionType === TRANSITION_TYPE_ESCAPE
        ? -1
        : 0;
  const encounterBody =
    encounter?.bodyIndex != null
      ? (nameByIndex.get(encounter.bodyIndex) ?? null)
      : null;
  const encounterTimeUt =
    encounter && encounter.transitionUt.isFinite()
      ? encounter.transitionUt.magnitude
      : null;

  const parentName = resolveFrame(bodies, frameSetting, vesselBody);

  // What the vessel's trajectory IS, asked once and handed to the diagram,
  // which draws whichever answer arrives. This widget held TWO independent
  // conic implementations of it, the ellipse the diagram draws from
  // `sma`/`ecc` and the `OrbitPatch` fabricated below, and neither asked
  // whether a conic was the right renderer at all.
  //
  // <b>Asked with NO read frame, deliberately, and the projection does the
  // framing instead.</b> The obvious wiring is to hand the projection's own
  // choice to this hook, and it is measurably wrong here: `useOrbitTrajectory`
  // has no memoisation, this widget re-renders at requestAnimationFrame rate
  // because `useUtNow` sets state on `clock.onFrame`, and a read frame turns
  // every conic answer into 128 reframed points, so the default path would put
  // ~7,700 points/sec through `Trajectory points transformed/sec` against its
  // 5,000 threshold. It would also delete a feature: the predicted multi-SOI
  // chain below is fabricated on a CONIC answer, and reframing makes that answer
  // an arc, so the SOI encounter markers would silently stop being drawn. So the
  // seam answers in the frame it computed in, says which, and the diagram lifts
  // it into the frame the bodies are in, which is where curve and bodies come to
  // share one frame.
  const vesselTrajectory: OrbitTrajectory | null = useOrbitTrajectory(orbit);
  const trajectoryWithheld =
    vesselTrajectory !== null && vesselTrajectory.shape === "withheld"
      ? vesselTrajectory
      : null;

  // Vessel orbit: feeds the dot drawn on its own orbit when the chosen frame
  // matches its parent body.
  const vSma = orbit?.sma?.magnitude;
  const vesselOrbit =
    vesselBody != null && orbit && orbit.sma.isFinite()
      ? {
          parentName: vesselBody,
          sma: orbit.sma.magnitude,
          ecc: orbit.ecc.magnitude,
          lan: orbit.lan?.magnitude ?? 0,
          argPe: orbit.argPe?.magnitude ?? 0,
          inclination: orbit.inc.magnitude,
          trueAnomaly: derived?.trueAnomaly ?? 0,
        }
      : null;

  // Predicted trajectory input for the diagram. Throttle `ut` into 1s buckets
  // (same as MapView) so the patch projection only re-runs ~1/sec, not on
  // every stream frame: the orbit shape doesn't change between ticks.
  const utBucket = quantiseUt(
    typeof universalTime === "number" ? universalTime : undefined,
    1,
  );
  // Client-propagated predicted trajectory: with only the current elements +
  // the next transition on the wire, the honestly-drawable
  // chain is a single conic, the current orbit sampled from the view-UT to the
  // encounter (an arc terminated at the SOI boundary) or, with no encounter,
  // over one full period (a closed ellipse). Built as the core `OrbitPatch`
  // shape so `SystemDiagram`'s existing Keplerian projection samples it
  // unchanged. The post-encounter conic's elements aren't on the wire, so the
  // chain never fabricates a second patch; the encounter is surfaced separately
  // from the derived `encounter*` scalars above (subtitle + almanac).
  //
  // Fabricated only on the CONIC answer. The `derived` scalars this leans on are
  // already gated on reach, so an out-of-horizon sample never got here, but
  // shape was never asked: a provider that integrates got a confident
  // one-period conic prediction plus, where an encounter was on the wire, an
  // SOI crossing predicted by maths it does not use. On the arc answer the
  // diagram draws the sampled path the provider vouched for instead, which is
  // the same curve honestly bounded.
  const orbitPatches = useMemo<OrbitPatch[]>(() => {
    if (!orbit || vesselBody == null || utBucket == null) return [];
    if (vesselTrajectory?.shape !== "conic") return [];
    const period = derived?.period;
    if (period == null || period <= 0) return [];
    if (!orbit.ecc.lessThan(1)) return []; // hyperbolic, elliptical only
    const hasEncounter =
      encounterExists !== 0 &&
      encounterTimeUt != null &&
      encounterTimeUt > utBucket;
    const endUT = hasEncounter ? encounterTimeUt : utBucket + period;
    return [
      {
        startUT: utBucket,
        endUT,
        patchStartTransition: "INITIAL",
        patchEndTransition: hasEncounter
          ? encounterExists === -1
            ? "ESCAPE"
            : "ENCOUNTER"
          : "FINAL",
        PeA: 0,
        ApA: 0,
        // `OrbitPatch` is the diagram's projection input: every element is
        // sampled into plot coordinates, so it stays plain numbers.
        inclination: orbit.inc.magnitude,
        eccentricity: orbit.ecc.magnitude,
        epoch: orbit.epoch.magnitude,
        period,
        argumentOfPeriapsis: orbit.argPe?.magnitude ?? 0,
        sma: orbit.sma.magnitude,
        lan: orbit.lan?.magnitude ?? 0,
        maae: orbit.meanAnomalyAtEpoch.magnitude,
        referenceBody: vesselBody,
        semiLatusRectum: 0,
        semiMinorAxis: 0,
        closestEncounterBody: encounterBody,
      },
    ];
  }, [
    orbit,
    vesselBody,
    utBucket,
    derived,
    vesselTrajectory,
    encounterExists,
    encounterTimeUt,
    encounterBody,
  ]);
  const predicted = useMemo(
    () =>
      orbitPatches.length > 0 && utBucket != null
        ? { orbitPatches, ut: utBucket }
        : null,
    [orbitPatches, utBucket],
  );

  // Children of the chosen frame: the only bodies actually drawn. Phase
  // angles only get subscribed for these, so the b.o.phaseAngle[i] sub
  // count tracks what's on screen, not the whole solar system.
  const children = useMemo(() => {
    if (parentName === null) return [] as readonly CelestialBody[];
    return bodies.filter(
      (b) => b.referenceBody !== null && b.referenceBody === parentName,
    );
  }, [bodies, parentName]);
  const phaseAngles = usePhaseAngles(children);

  // Transfer-window highlighting. Only meaningful when the rendered frame is
  // the same parent the vessel orbits: otherwise the bodies aren't co-orbital
  // with the vessel and the Hohmann formula doesn't apply.
  const transferStatuses = useMemo(() => {
    const out = new Map<number, "go" | "soon">();
    if (typeof vesselBody !== "string") return out;
    if (parentName !== vesselBody) return out;
    if (typeof vSma !== "number" || !Number.isFinite(vSma)) return out;
    for (const child of children) {
      const rB = child.semiMajorAxis;
      if (typeof rB !== "number" || !Number.isFinite(rB)) continue;
      const live = phaseAngles.get(child.index);
      if (typeof live !== "number") continue;
      const ideal = hohmannPhaseAngle(vSma, rB);
      if (!Number.isFinite(ideal)) continue;
      const delta = angleDelta(live, ideal);
      const status: TransferStatus = transferStatus(delta);
      if (status !== "off") out.set(child.index, status);
    }
    return out;
  }, [children, phaseAngles, vesselBody, parentName, vSma]);

  const [focusedBody, setFocusedBody] = useState<CelestialBody | null>(null);
  // Default focus to the vessel's body when nothing is hovered, gives the
  // panel useful content out of the box.
  const vesselBodyRecord = useMemo(
    () =>
      typeof vesselBody === "string"
        ? (bodies.find((b) => b.name === vesselBody) ?? null)
        : null,
    [bodies, vesselBody],
  );
  const panelBody = focusedBody ?? vesselBodyRecord;
  const nowUt = typeof universalTime === "number" ? universalTime : null;
  const panelPhaseAngle =
    panelBody && phaseAngles.has(panelBody.index)
      ? (phaseAngles.get(panelBody.index) ?? null)
      : null;
  const panelIsVesselParent =
    panelBody !== null &&
    typeof vesselBody === "string" &&
    panelBody.name === vesselBody;
  // Hohmann ideal + delta for the panel's body, if all the inputs line up.
  const panelHohmann =
    panelBody !== null &&
    typeof vesselBody === "string" &&
    parentName === vesselBody &&
    panelBody.referenceBody === vesselBody &&
    typeof vSma === "number" &&
    Number.isFinite(vSma) &&
    typeof panelBody.semiMajorAxis === "number" &&
    Number.isFinite(panelBody.semiMajorAxis)
      ? (() => {
          const ideal = hohmannPhaseAngle(vSma, panelBody.semiMajorAxis);
          if (!Number.isFinite(ideal)) return null;
          const delta =
            panelPhaseAngle !== null
              ? angleDelta(panelPhaseAngle, ideal)
              : null;
          return { ideal, delta };
        })()
      : null;

  // Diagram size: feeds the SVG viewBox aspect. It measures the diagram's own
  // box inside the panel body, so it legitimately shrinks when the almanac
  // mounts beside it. (The tile-shaped measurement that used to sit here, and
  // the side/bottom almanac gates it fed, are the panel's job now:
  // `sidebarSide="auto"` measures the split container, whose border box does
  // not move when the arrangement flips, and picks the axis from it.)
  const { ref: wrapRef, size } = useElementSize({ w: 360, h: 280 });

  // Selective rendering: the diagram needs real area. At small sizes collapse
  // to a text "Frame: X" summary, with no almanac beside it.
  const cols = w ?? 10;
  const rows = h ?? 12;
  const showDiagram = rows >= 5 && cols >= 5;
  // The almanac needs room of its own ON TOP of the diagram's. Panel picks the
  // AXIS, and correctly refuses to put a 14rem sidebar beside a 232px tile, but
  // it cannot know that at that size the widget would rather be a diagram than
  // a squashed diagram over a clipped table. So the widget decides whether to
  // offer one at all. The thresholds are the old showSideAlmanac / bottom gates,
  // collapsed into one: either axis having room is enough, since Panel chooses
  // which.
  const showAlmanac = showDiagram && (cols >= 9 || rows >= 12);

  // The frame the whole picture is drawn in.
  //
  // Every entry anyone offers for any body, filtered to the body this diagram is
  // centred on. The host's own stock entries arrive through the same slot as a
  // third party's, so the filter and the resolver are exercised on a bare install
  // and there is no absence to branch on: the diagram always has a frame, and the
  // question is only which one.
  const projectionEntries = useContributions("system-view.projection");
  const frameBodyIndex =
    parentName === null ? undefined : facts?.indexByName[parentName];
  const projectionOptions = useMemo(
    () =>
      frameBodyIndex === undefined
        ? []
        : projectionEntries.filter((p) => p.frameBodyIndex === frameBodyIndex),
    [projectionEntries, frameBodyIndex],
  );
  const chosenProjectionEntry = useMemo(() => {
    const pinned = projectionOptions.find((p) => p.id === config?.projection);
    if (pinned !== undefined) return pinned;
    // Falling back to the FIRST entry for this body rather than to nothing. The
    // host contributes the inertial one first, so an absent or stale saved id
    // lands on the picture this widget always drew.
    return projectionOptions[0] ?? null;
  }, [projectionOptions, config?.projection]);

  // Resolved on the one-second UT bucket, never per render. `frameInstantAt`
  // solves every body's parent chain and the diagram places a few thousand points
  // through the result, and this widget re-renders every animation frame, so
  // rebuilding here is the regression `SystemView body placements/sec` exists to
  // catch.
  const projection = useMemo(
    () =>
      resolveProjection(facts, frameBodyIndex, chosenProjectionEntry, utBucket),
    [facts, frameBodyIndex, chosenProjectionEntry, utBucket],
  );

  // Slot props. `overlay` carries the diagram's parent-centric projection so an
  // augment can draw in the SVG's coordinate space: the metres → px `plotScale`
  // is reconstructed exactly as `SystemDiagram` derives it (auto-fit over the
  // drawn children + the vessel's own orbit when it shares the frame). It is
  // null until there is a frame and a measured diagram to overlay.
  const overlayContext = useMemo<SystemOverlayContext | null>(() => {
    if (parentName === null || size.w <= 0 || size.h <= 0) return null;
    let maxRadius = 0;
    for (const child of children) {
      const ecc = Math.min(Math.max(child.eccentricity ?? 0, 0), 0.999);
      const apo = (child.semiMajorAxis ?? 0) * (1 + ecc);
      if (apo > maxRadius) maxRadius = apo;
    }
    const vesselExtent =
      vesselOrbit && frameNameMatches(vesselOrbit.parentName, parentName)
        ? vesselOrbit.sma * (1 + Math.min(vesselOrbit.ecc, 0.999))
        : 0;
    const effectiveMax = Math.max(maxRadius, vesselExtent);
    const baseRadius = Math.min(size.w, size.h) / 2 - DIAGRAM_PAD;
    const extent = projection?.extent ?? { kind: "auto-fit-metres" };
    const plotScale =
      extent.kind === "fixed-units"
        ? extent.units > 0
          ? baseRadius / extent.units
          : 1
        : effectiveMax > 0
          ? baseRadius / effectiveMax
          : 1;
    return {
      parentName,
      width: size.w,
      height: size.h,
      plotScale,
      // The frame body's own drawn position, which is the origin only in a frame
      // centred on it. A contributed entity is positioned relative to the frame
      // body, so this is what its metres are measured from.
      center: { x: 0, y: 0 },
      placement: projection ?? undefined,
    };
  }, [parentName, children, vesselOrbit, size, projection]);

  // The info panel: the selected vessel's own roster fields (name/type/
  // situation/body/crew/comms, carried on its entity's `meta`) when
  // something is selected, else the frame body's almanac unchanged.
  // Deselecting (Escape / click again, both drive `selectedVesselId` back
  // to null) falls back here automatically, no separate reset needed.
  const almanac = (
    <AlmanacPanel
      body={panelBody}
      phaseAngleDeg={panelPhaseAngle}
      isVesselParent={panelIsVesselParent}
      hohmannIdealDeg={panelHohmann?.ideal ?? null}
      hohmannDeltaDeg={panelHohmann?.delta ?? null}
      encounterDirection={
        // The vessel's next SOI transition (client-derived from
        // `vessel.orbit.encounter`), shown on the panel body it targets.
        encounterExists !== 0 &&
        encounterBody != null &&
        panelBody !== null &&
        panelBody.name === encounterBody
          ? encounterExists === -1
            ? "escape"
            : "encounter"
          : null
      }
      encounterTimeSec={
        // `encounterTimeUt` is an ABSOLUTE UT (transitionUt); the panel
        // wants seconds-to-event, so subtract the view-UT.
        encounterTimeUt != null && nowUt !== null
          ? encounterTimeUt - nowUt
          : null
      }
      nextApsisType={
        derived?.nextApsisType === -1 || derived?.nextApsisType === 1
          ? derived.nextApsisType
          : null
      }
      nextApsisTimeSec={
        typeof derived?.timeToNextApsis === "number"
          ? derived.timeToNextApsis
          : null
      }
    />
  );
  const sidebarContent =
    selectedEntity?.meta != null ? (
      <VesselInfoPanel meta={selectedEntity.meta} />
    ) : (
      almanac
    );

  return (
    <Panel
      panelTitle="SYSTEM"
      // The almanac is a second scrolling region, not more body content:
      // reading it must not scroll the diagram it describes off the tile.
      // `auto` measures the tile and picks the axis, which is the pair of
      // arrangements this widget used to compute for itself (a right-hand
      // column on a wide tile, a bottom strip on a tall one).
      panelSidebar={showAlmanac ? sidebarContent : undefined}
    >
      <div style={FRAME_CAPTION} role="status" aria-live="polite">
        {bodies.length === 0
          ? "Waiting for body data..."
          : parentName === null
            ? "Pick a frame in the widget config."
            : encounterExists !== 0 && encounterBody != null
              ? `Frame: ${parentName} · next ${
                  encounterExists === -1 ? "escape" : "encounter"
                }: ${encounterBody}`
              : `Frame: ${parentName}`}
      </div>
      <ContactCaption
        status={vesselStatus}
        vesselName={
          typeof identity?.name === "string" ? identity.name : "Vessel"
        }
      />
      {/* Beside the frame caption rather than over the diagram: the bodies are
          still being drawn correctly and only the vessel's own curve is
          missing, so covering the picture would overstate what was refused. */}
      {trajectoryWithheld && (
        <TrajectoryWithheldNote withheld={trajectoryWithheld} compact />
      )}
      {/* Which frame the PICTURE is in, which is not the same fact as the
          "Frame:" caption above: that one is which body sits in the middle, and
          this one is what the axes do. The frame is passed outright rather than
          taken off the drawn path, because the diagram does its own framing: the
          seam answers in whatever frame it computed in and the diagram lifts the
          answer, so captioning the path's frame would name a frame this picture
          is not in. Absent means the catalogue could not form the chosen frame,
          and the picture is in the parent-centred inertial coordinates it
          already had. */}
      <TrajectoryFrameCaption
        frame={projection?.frame ?? null}
        centreBodyName={parentName ?? undefined}
      />
      {showDiagram ? (
        <FramedDisplay style={DIAGRAM_FRAME}>
          <div ref={wrapRef} style={DIAGRAM_WRAP}>
            {parentName !== null && bodies.length > 0 && (
              <SystemDiagram
                bodies={bodies}
                parentName={parentName}
                highlightNames={vesselBody ? [vesselBody] : []}
                targetName={typeof targetName === "string" ? targetName : null}
                vessel={vesselOrbit}
                vesselTrajectory={vesselTrajectory}
                vesselPlotState={vesselPlotState}
                phaseAngles={phaseAngles}
                transferStatuses={transferStatuses}
                onFocusBodyChange={setFocusedBody}
                predicted={predicted}
                projection={projection}
                width={size.w}
                height={size.h}
              />
            )}
            {/* Shape-contribution entities: host-drawn (not an augment), same
                auto-fit projection as the overlay slot below it. Renders
                nothing when the slot is empty or nothing on it projects onto
                the current frame. */}
            {overlayContext !== null && (
              <SystemEntitiesLayer
                entities={entities}
                ctx={overlayContext}
                decorate={decorate}
                selectedId={selectedVesselId}
                onEntityActivate={handleEntityActivate}
                pulses={traffic.pulses}
                // Real-time bookkeeping clock, same one command traffic
                // above already rides: a CME's `arriveUt`/`clearUt` are
                // real-UT facts the mod stamps the instant a storm rolls,
                // not delayed craft telemetry, so this drives its single,
                // non-looping travelling-pulse pass (see
                // `SystemEntitiesLayer.tsx`'s own `nowUt` doc comment).
                nowUt={utNow}
              />
            )}
            {/* Overlay slot: layered over the body diagram, passed the diagram's
                parent-centric projection so an augment draws in its coordinate
                space. The layer is pointer-transparent so an empty slot is
                visually + interactively inert. */}
            {overlayContext !== null && (
              <div style={OVERLAY_LAYER}>
                <AugmentSlot
                  name="system-view.overlay"
                  props={overlayContext}
                />
              </div>
            )}
          </div>
        </FramedDisplay>
      ) : (
        <div style={COMPACT_BODY}>
          <div style={COMPACT_VALUE}>{parentName ?? NULL_DISPLAY}</div>
          {typeof vesselBody === "string" && vesselBody !== parentName && (
            <div style={COMPACT_SUB}>vessel · {vesselBody}</div>
          )}
        </div>
      )}
    </Panel>
  );
}

function resolveFrame(
  bodies: readonly { name: string | null; referenceBody: string | null }[],
  setting: string,
  vesselBody: string | null,
): string | null {
  if (setting === "auto") {
    // Follow the vessel's current body. On the launchpad / in Kerbin
    // orbit this is Kerbin (so the diagram shows Mun/Minmus); from Mun
    // orbit it's Mun. If we don't have v.body yet, fall back to the
    // root so something useful renders.
    if (vesselBody) return vesselBody;
    const root = bodies.find((b) => !b.referenceBody);
    return root?.name ?? null;
  }
  if (setting === "root") {
    // Walk up to the topmost parent (Kerbol from anywhere in the system).
    if (!vesselBody) {
      const root = bodies.find((b) => !b.referenceBody);
      return root?.name ?? null;
    }
    let cursor: string | null = vesselBody;
    const seen = new Set<string>();
    while (cursor !== null && !seen.has(cursor)) {
      seen.add(cursor);
      const body = bodies.find((b) => b.name === cursor);
      if (!body) break;
      if (!body.referenceBody) return body.name;
      cursor = body.referenceBody;
    }
    return cursor;
  }
  // Back-compat: previous default was "current"; treat as "auto".
  if (setting === "current") return vesselBody;
  return setting; // explicit body name
}

// ── Config ────────────────────────────────────────────────────────────────────

function SystemViewConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<SystemViewConfig>>) {
  const bodies = useCelestialBodies();
  const facts = useProcessor(CELESTIAL_FACTS);
  const [frame, setFrame] = useState(config?.frame ?? "auto");
  const [projection, setProjection] = useState(config?.projection ?? "");

  // The projections that apply to the body this config's own frame setting
  // resolves to. "auto" cannot be resolved here (it follows the live vessel), so
  // the list falls back to the root body's, which is the one a whole-system view
  // is centred on.
  const frameBodyName =
    frame === "auto" || frame === "root"
      ? (bodies.find((b) => b.referenceBody === null)?.name ?? null)
      : frame;
  const frameBodyIndex =
    frameBodyName === null ? undefined : facts?.indexByName[frameBodyName];
  const allProjections = useContributions("system-view.projection");
  const projectionOptions = useMemo(
    () =>
      frameBodyIndex === undefined
        ? []
        : allProjections.filter((p) => p.frameBodyIndex === frameBodyIndex),
    [allProjections, frameBodyIndex],
  );

  const candidate = useMemo<SystemViewConfig>(
    () => (projection === "" ? { frame } : { frame, projection }),
    [frame, projection],
  );

  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="system-frame">Frame of reference</FieldLabel>
        <Select
          id="system-frame"
          value={frame}
          onChange={(e) => setFrame(e.target.value)}
        >
          <option value="auto">Auto (current body)</option>
          <option value="root">Root parent (whole system)</option>
          {bodies
            .filter((b) => b.name !== null)
            .map((b) => (
              <option key={b.index} value={b.name ?? ""}>
                {b.name}
              </option>
            ))}
        </Select>
        <FieldHint>
          "Auto" follows the vessel's current body: Kerbin-orbit shows
          Mun/Minmus, Mun-orbit shows Mun. "Root parent" walks up to the star so
          you see the whole system. Pick a specific body to pin the frame.
        </FieldHint>
      </Field>
      <Field>
        <FieldLabel htmlFor="system-projection">Draw the picture in</FieldLabel>
        <Select
          id="system-projection"
          value={projection}
          onChange={(e) => setProjection(e.target.value)}
        >
          <option value="">Follow the frame (the ordinary view)</option>
          {projectionOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
        <FieldHint>
          This changes what the axes do, not which body is in the middle. The
          bodies, their orbits and the craft all move together: holding the
          parent still is how a transfer window becomes a shape you can see, and
          the orbit stops looking closed because it is not. The panel says which
          one you are looking at.
        </FieldHint>
      </Field>
    </ConfigForm>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

// Structural inline styles (CSS-var tokens): a bespoke diagram frame + compact
// fallback, no reusable ui-kit primitive fits, so the layout stays local. The
// one kit piece it reuses (FramedDisplay) takes only this widget's flex sizing
// inline.

const FRAME_CAPTION: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
  letterSpacing: "0.05em",
  flex: "0 0 auto",
};

const COMPACT_BODY: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--space-4)",
};

const COMPACT_VALUE: CSSProperties = {
  // Off the type scale: the scale stops at --font-size-lg (16px) and this is a
  // display-tier readout.
  fontSize: "22px",
  fontWeight: 700,
  color: "var(--color-text-primary)",
  letterSpacing: "0.04em",
};

const COMPACT_SUB: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
  letterSpacing: "0.05em",
};

// The frame around the diagram. It replaces the widget's old grid border AND
// the almanac's divider rule: with the visual framed, the frame's own edge is
// what separates it from the sidebar, whichever edge the sidebar lands on.
// Flush because SystemDiagram already reserves its own padding inside the
// viewBox, so an inner gutter here reads as a double border.
const DIAGRAM_FRAME: CSSProperties = { flex: 1, minWidth: 0, minHeight: 0 };

// The `svg { display:block; flex:1 }` descendant rule (not inline-expressible)
// moves onto SystemDiagram's own root <svg>.
const DIAGRAM_WRAP: CSSProperties = {
  position: "relative",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  alignItems: "stretch",
  justifyContent: "stretch",
};

const OVERLAY_LAYER: CSSProperties = {
  position: "absolute",
  inset: 0,
  // Keep the diagram beneath interactive (pan/zoom/hover); an overlay augment
  // re-enables pointer events on its own elements when it needs them.
  pointerEvents: "none",
};

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<SystemViewConfig>({
  id: "system-view",
  name: "System View",
  description:
    "Solar-system diagram of every body orbiting a chosen parent, highlighting the vessel's current body and any selected target.",
  tags: ["telemetry", "navigation"],
  defaultSize: { w: 10, h: 12 },
  minSize: { w: 3, h: 4 },
  component: SystemViewComponent,
  configComponent: SystemViewConfigComponent,
  // Exposes a coordinated `.actions` + `.overlay` pair: one augment can drive
  // an overlay from a header control, sharing its own context. `.actions` is
  // the framework's universal header segment (`Panel` mounts it for every
  // widget) and is listed here because this is where an author looks to find
  // what a widget opens up; `.overlay` is this widget's own, and passes the
  // diagram's projection as typed slot props.
  augmentSlots: ["system-view.actions", "system-view.overlay"],
  // Two contribution slots. `system-view.vessel-status` is the plotted
  // vessel's node decoration, fed by the built-in comms-derived contribution
  // (`./vesselStatusContribution.ts`) and open to any Uplink contributing
  // SEMANTIC status for the same vessel. `system-view.entities` is the shape
  // foundation: a flat list of positioned display objects anyone can add to,
  // aggregated by `ContributionsAggregation` via `WidgetMetaContext`
  // (`GridItemContent.tsx` reads this list to build that context) and read
  // back here through `useContributions`.
  contributionSlots: [
    "system-view.vessel-status",
    "system-view.entities",
    "system-view.projection",
  ],
  // The body table + phase angles still fan out over the shared `b.*` hooks
  // (`useCelestialBodies`/`usePhaseAngles`): a separate, shared-hook migration.
  // Everything else reads the streamed `vessel.*`/`system.bodies` Topics below.
  // The widget walks the body ARRAY (`systemBodies?.bodies`) and never reads a
  // count, so it declares the array. The old `b.number` mapped to the derived
  // `system.state.bodyCount`, a value this widget does not render: keeping it
  // would point body-count alarms here on the strength of a key nothing reads.
  dataRequirements: ["system.bodies"],
  optionalChannels: [
    "vessel.orbit",
    "vessel.identity",
    "vessel.target",
    "system.bodies",
    // The CommNet path derivation reads this
    // directly (`useTelemetry("comms.network")`), on top of the built-in
    // contribution's own subscription through the SlotAggregator.
    "comms.network",
    // Command traffic: read directly via `useLatestValue`, same
    // reasoning as `comms.network` above.
    "system.uplink.pending",
  ],
  defaultConfig: { frame: "auto" },
  actions: [],
  pushable: true,
});

export { AlmanacPanel } from "./AlmanacPanel";
export { SystemEntitiesLayer } from "./SystemEntitiesLayer";
export type {
  ResolvedSystemEntity,
  SystemEntitiesContext,
  SystemEntity,
  SystemEntityEmphasis,
  SystemEntityFixedPosition,
  SystemEntityMeta,
  SystemEntityOrbitPosition,
  SystemEntityPosition,
  SystemEntitySeverity,
  SystemEntityShape,
  SystemEntityStyle,
} from "./systemEntities";
export {
  projectEntityPosition,
  projectOrbitRing,
  resolveSystemEntities,
  SYSTEM_ENTITY_DEFAULT_LAYER,
} from "./systemEntities";
export type { CelestialBody } from "./useCelestialBodies";
export { useCelestialBodies } from "./useCelestialBodies";
export { usePhaseAngles } from "./usePhaseAngles";
export { SystemViewComponent };
