import type { ComponentProps, ConfigComponentProps } from "@ksp-gonogo/core";
import { AugmentSlot, registerComponent, useTelemetry } from "@ksp-gonogo/core";
import { observedAt, type Reading, useViewUt } from "@ksp-gonogo/sitrep-client";
import { TargetKind, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Box,
  Cluster,
  ConfigForm,
  Countdown,
  EmptyState,
  Field,
  FieldHint,
  FieldLabel,
  // The game-time ladder, which is right here because the age is UT
  // (`viewUt - atUt`), not desk time. `formatIrlDuration`'s doc names "how long
  // ago a reading was seen" as a wall-clock case, and that holds only for an age
  // measured off a wall clock; the wall-clock ratchet requires this one be
  // measured off the frame, so it is game seconds and takes the game ladder.
  formatDuration,
  Grid,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  Select,
  Stack,
  Switch,
  Text,
  Truncate,
  Unit,
  useModalSaveBar,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  bare,
  deriveDockAngles,
  radialSpeed,
  targetKindLabel,
  vecMagnitude,
} from "../shared/dockAngles";
import { magnitudeOf } from "../shared/magnitude";
// Side-effect import: registers the `vessel.target` reckoner (stubbed, so it
// declines and the widget renders no modelled figure) plus the frame-memoised
// processor its arithmetic will run through.
import "./targetReckoning";

type DockingHudMode = "hud" | "hud-with-camera";

interface DistanceToTargetConfig {
  /**
   * Auto-switch to the docking HUD when the target is a vessel or docking
   * port and the distance drops under the approach threshold. Defaults to
   * true so the feature is discoverable without configuration.
   */
  autoSwitch?: boolean;
  /** Which HUD variant auto-switch promotes to. Default "hud-with-camera". */
  hudMode?: DockingHudMode;
  /**
   * Optional camera id pinning which feed backs the video backdrop. Unset →
   * the filling augment chooses (a camera Uplink is far better placed to pick
   * than this widget: it can see which camera is actually a docking camera).
   * Meaningful only when `hudMode === "hud-with-camera"`. Kept as an opaque
   * number so this widget stays camera-vendor-agnostic; it is passed straight
   * through to the augment via `DistanceToTargetHudContext`.
   */
  cameraFlightId?: number | null;
}

// ── Augment slots (Uplink architecture) ─────────────────────────────────────
//
// This widget owns three slots (`augment-slot-map.md`, DistanceToTarget row).
// Two are OVERLAY slots on the docking HUD and so PASS slot-props, an
// overlay augment must draw in the HUD's own reticle space, so it receives
// the parent's coordinate frame:
//
//   • `distance-to-target.camera` : a video backdrop behind the reticle/HUD.
//     FILLED: a camera Uplink's augment now draws the close-range docking
//     view here (not a standalone CameraFeed instance). The built-in
//     `HudCamera` backdrop this slot once carried has been REMOVED along with
//     it: it hard-wired one specific camera mod into the core widget, which
//     is precisely what the slot exists to avoid. This widget no longer knows
//     what a camera is: it decides WHETHER a backdrop should show
//     (`hudMode`/viewport size) and passes its reticle frame down; the augment
//     decides WHICH camera and renders it. An install with no camera Uplink
//     composes the HUD with no video layer.
//   • `distance-to-target.overlay`: alignment markers layered on top of the
//     crosshair/reticle. A precision-docking / laser-rangefinder Uplink draws
//     into the reticle box using the passed context. Composable by priority
//     so several rangefinder/marker augments coexist.
//
// The third is the broad `.badges` escape hatch, an inline header indicator
// (e.g. an autopilot Uplink's active docking-mode chip).

/**
 * Coordinate/context the docking-HUD overlay slots pass down so an augment
 * can render in the HUD's own reticle space. Shared by both the camera
 * backdrop (`distance-to-target.camera`) and the alignment-marker overlay
 * (`distance-to-target.overlay`).
 */
export interface DistanceToTargetHudContext {
  /** Half-range in degrees the reticle box maps to; the reticle clamps at the edge. */
  maxDeg: number;
  /**
   * Reticle-centre offset from HUD centre, each component in −1..1 (clamped
   * alignment angle ÷ `maxDeg`; `y` already flipped for screen coords so
   * positive is downward).
   */
  reticleOffset: { x: number; y: number };
  /**
   * Percent of the half-box the reticle travels per unit of `reticleOffset`
   * (the `40` in the reticle's `left: 50 + dx·40 %` positioning), an overlay
   * places a marker at `50 + offset·reticleTravelPct` % to sit in the same space.
   */
  reticleTravelPct: number;
  /** True while the two ports are within docking-alignment tolerance. */
  aligned: boolean;
  /** Raw docking alignment angles in degrees; undefined outside a docking scenario. */
  ax: number | undefined;
  ay: number | undefined;
  /** Range to the target in metres; undefined until the stream reports position. */
  distance: number | undefined;
  /**
   * Camera id the operator pinned for the backdrop, or unset to let the
   * augment choose. Opaque to this widget: the filling augment interprets it.
   */
  cameraFlightId: number | null | undefined;
}

/**
 * Context the `distance-to-target.badges` header slot passes to inline-indicator
 * augments so a badge can describe the current target without its own reads.
 */
export interface DistanceToTargetBadgeContext {
  /** Current target name, or undefined when no target is set. */
  targetName: string | undefined;
  /** KSP target type (`Vessel`, `CelestialBody`, a docking-port type, ...). */
  targetType: string | undefined;
  /** Range to the target in metres; undefined until the stream reports position. */
  distance: number | undefined;
}

// Declaration-merge the slot ids → props types into core's `SlotRegistry` (a
// hybrid, declaration-merging approach). Co-located here per-widget: no shared
// central registry file: so parallel slot work in other widgets never collides.
// This is what makes `registerAugment` / `<AugmentSlot props={...}>` type-check the
// contexts above precisely, rather than the loose `Record<string, unknown>`
// fallback an unmerged slot id would get.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "distance-to-target.camera": DistanceToTargetHudContext;
    "distance-to-target.overlay": DistanceToTargetHudContext;
    "distance-to-target.badges": DistanceToTargetBadgeContext;
  }
}

// The facade-sealed-client copy of this merge lives in
// `mod/sitrep-sdk/src/api/slots.ts`, not a second `declare module
// "@ksp-gonogo/sitrep-sdk"` block here: see MapView/index.tsx's identical
// comment / that module's header for why
// (docs/superpowers/plans/2026-07-19-facade-sealing.md §2.3).

// Distances are in metres. Hysteresis prevents strobing at the thresholds.
const HUD_ENTER_M = 100;
const HUD_EXIT_M = 150;
const APPROACH_ENTER_M = 5_000;
const APPROACH_EXIT_M = 5_500;

type ViewMode = "tracking" | "approach" | "docking-hud";

/**
 * The last REAL observation behind a reading, whatever its currency, or nothing
 * where there has not been one.
 *
 * Used only to derive the scalars the widget already computed client-side
 * (distance, closing rate, dock angles) so that arithmetic stays in one place
 * rather than being duplicated per arm. It deliberately does NOT decide how the
 * result is presented: every caller branches on `targetReading.state` for that,
 * and the non-observed branches are the ones that render the age. Passing this
 * result straight to a readout without checking the state would reintroduce
 * exactly the bug the union prevents, which is why it is a local helper and not
 * exported.
 *
 * It never returns a MODELLED value: a reckoning is pulled explicitly through
 * `reckon()` in the branch that renders it, so a propagated number can never
 * arrive at a readout by accident.
 */
/**
 * The value a VERDICT may be drawn from: current, or modelled forward to the frame.
 * A stale reading gives nothing, because a judgement cannot be dated: the operator
 * reads a band or a pill as the situation NOW.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

/** Whether a reading went stale, as opposed to never having arrived. */
function notCurrent<T>(reading: Reading<T>): boolean {
  return reading.state === "stale";
}

/**
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
function stillTrue<T, A>(
  reading: Reading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "reckonable") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

function observedPayload<T>(reading: Reading<T>): T | undefined {
  switch (reading.state) {
    case "observed":
    case "stale":
    case "reckonable":
      return reading.value;
    default:
      return undefined;
  }
}

function DistanceToTargetComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<DistanceToTargetConfig>>) {
  const autoSwitch = config?.autoSwitch !== false;
  const hudMode: DockingHudMode = config?.hudMode ?? "hud-with-camera";

  // `vessel.target` reads as a `Reading`, not a bare payload: this widget used
  // to render "No target set in KSP" whenever `tar.name` was undefined, which
  // is a positive claim about game state made from the absence of a frame. A
  // dropped link said "no target set". The union is what makes that
  // unrepresentable, because reaching a value at all now requires branching on
  // how current it is. `vessel.target` is declared `absenceIsData: true`
  // mod-side, so the confirmed-absence arm is a real wire state here, not a
  // theoretical one.
  //
  // `vessel.dock` splits per FIELD, not per topic. The PAIRING is a fact: a
  // docking scenario exists because the operator selected a port and our side
  // has a free one, and no link outage can change that while nobody is looking.
  // The GEOMETRY carried on the same record is the opposite kind of thing: a
  // reticle, an alignment angle and a port-to-port closing rate are all read as
  // "fly this, now", so they go through `judgeable` and stop being drawn the
  // moment they stop being current. A reticle placed from a last-known relative
  // position asserts an attitude it cannot know, which is the sharpest form of
  // the failure the union exists to prevent.
  //
  // `absent` and `pending` stay indistinguishable here, exactly as they were
  // before the migration. `vessel.dock` is declared `absenceIsData` mod-side, so
  // a tombstone genuinely means "not a docking scenario", and never-arrived
  // leaves the widget with the same nothing to draw. Neither one is a readout
  // that could carry different wording: the only visible consequence is a HUD
  // that does not open.
  const targetReading = useTelemetry("vessel.target");
  const dockReading = useTelemetry("vessel.dock");
  const dock = judgeable(dockReading);
  const dockPairing = stillTrue(dockReading, undefined);
  const target = observedPayload(targetReading);

  const tarName = target?.name;
  const tarKind = target?.kind;
  const tarType = targetKindLabel(tarKind);
  // Closest approach is now MOD-side (the elected IPropagationProvider),
  // carried on `vessel.target.closestApproach`: replaces the former SDK-side
  // two-body solve (o.closestTgtApprUT / vessel.state.closestApproachUt).
  // `t.universalTime` stays dropped: the "current time" IS the SDK view-UT the
  // propagation is evaluated at, read directly via `useViewUt`.
  // `.magnitude`: a UT the widget subtracts the view-UT from, so it wants a
  // number. `Number.isFinite` on the wrapper answered "no approach" for every
  // real one and the TCA readout was a permanent em dash.
  const closestApproachUT = magnitudeOf(target?.closestApproach?.time);
  /**
   * `.magnitude` at the read, and it matters more here than it reads.
   *
   * Two guards below test this with `typeof === "number"` and `Number.isFinite`.
   * Both answer NO for a wrapped value, so leaving it an instant would silently
   * null the TCA readout and the approach countdown, with no type error anywhere:
   * a runtime type check is a third blind spot alongside an `unknown` parameter
   * and an `as` cast.
   */
  const universalTime = useViewUt()?.magnitude;

  const tarRelPos = target?.relativePosition && bare(target.relativePosition);
  const tarRelVelVec =
    target?.relativeVelocity && bare(target.relativeVelocity);
  // vessel.dock is null unless the target is a docking port with a free
  // port on the active vessel: undefined here legitimately means "not a
  // docking scenario right now", not "still loading". Post-migration it also
  // means "the geometry is no longer current", and `alignmentWithheld` below is
  // what tells those two apart on screen.
  const dockRelPos = dock?.relativePosition && bare(dock.relativePosition);
  const dockRelVelVec = dock?.relativeVelocity && bare(dock.relativeVelocity);
  const dockDistanceStream = dock?.distance?.magnitude;
  const dockForwardDot = dock?.forwardDot;

  const tarDistance = tarRelPos ? vecMagnitude(tarRelPos) : undefined;
  const relVel =
    tarRelPos && tarRelVelVec
      ? radialSpeed(tarRelPos, tarRelVelVec)
      : undefined;
  const derivedDockAngles = dockRelPos
    ? deriveDockAngles(dockRelPos)
    : undefined;
  const dockAx = derivedDockAngles?.ax;
  const dockAy = derivedDockAngles?.ay;
  // Docking-port roll (az) misalignment isn't on the wire at all, vessel.dock
  // carries only RelativePosition/RelativeVelocity/Distance + a scalar
  // ForwardDot. The true third axis is unavailable and renders NULL_DISPLAY.
  const dockAz: number | undefined = undefined;
  const dockX = dockRelPos?.x;
  const dockY = dockRelPos?.y;
  const derivedDockRelVel =
    dockRelPos && dockRelVelVec
      ? radialSpeed(dockRelPos, dockRelVelVec)
      : undefined;
  // Docking HUD's Δv row prefers the port-to-port closing rate (more
  // accurate at close range) over the general vessel-to-vessel figure.
  const dockingRelVel = derivedDockRelVel ?? relVel;
  const dockingDistance = dockDistanceStream ?? tarDistance;

  // Header `.badges` slot context: a fresh object each render so the indicator
  // tracks live target data. Passed as the tracking panel's `panelAside`, so it
  // renders next to the widget title; the specialised approach/docking modes
  // keep their own bespoke headers.
  const badgeContext: DistanceToTargetBadgeContext = {
    targetName: tarName,
    targetType: tarType,
    distance: tarDistance,
  };

  // Mode hysteresis: sticky so we don't strobe near a threshold, and the
  // upgrade direction is asymmetric (smaller window to enter than to exit).
  const [mode, setMode] = useState<ViewMode>("tracking");

  // "Close-ops eligible" = a real target that isn't a celestial body, drives
  // the mid-range APPROACH view (rendezvous distance/closing rate), valid for
  // any Vessel/Part target, matching the old `tarType !== "CelestialBody"`.
  const dockable =
    tarKind !== undefined &&
    tarKind !== TargetKind.Body &&
    tarName !== undefined;

  // The docking HUD's reticle + α/β alignment instrument only has signal when
  // the mod is actually publishing `vessel.dock`, which it does ONLY for a
  // docking-port target with a free "Ready" port on the active vessel
  // (VesselDock.cs). A plain Vessel/Other target (or a port with no free port
  // on our side) has no dock channel, so promoting it to the HUD on distance
  // alone rendered a dead-centre reticle with every alignment row NULL_DISPLAY. Gate HUD
  // entry on the dock channel actually carrying a relative position, NOT on
  // "any non-body target under 100 m".
  const dockingAvailable = dockRelPos !== undefined;

  // The pairing is still selected but its geometry is no longer current, so the
  // reticle is being WITHHELD rather than never having existed. Worth its own
  // flag because the two look identical from outside: the HUD simply is not
  // there, and without this the operator would read a link that went quiet as a
  // target that stopped being a docking port. The approach view names it.
  const alignmentWithheld =
    notCurrent(dockReading) && dockPairing?.relativePosition !== undefined;
  // The age, spelled out now that `readingAge` is gone: an instant minus an instant
  // is a duration, and the affine rules make that the type. The clamp came with it
  // and stays, because samples arrive out of order (`ClientTimeline` insert-sorts
  // for it) so one can sit marginally ahead of the frame and "-0.4 s ago" is never
  // a thing to render.
  const dockObservedUt = observedAt(dockReading);
  const dockAgeSec =
    universalTime !== undefined && dockObservedUt
      ? Math.max(0, value("ut", universalTime).minus(dockObservedUt).magnitude)
      : undefined;

  useEffect(() => {
    // The specialised views assert something about NOW: a closing rate to act
    // on, an alignment reticle to fly. Both are only honest off a current
    // reading, so anything else falls back to the tracking panel, which is the
    // one rendering that can state its own age.
    if (
      !autoSwitch ||
      !dockable ||
      tarDistance === undefined ||
      targetReading.state !== "observed"
    ) {
      if (mode !== "tracking") setMode("tracking");
      return;
    }
    if (mode === "tracking") {
      if (dockingAvailable && tarDistance <= HUD_ENTER_M)
        setMode("docking-hud");
      else if (tarDistance < APPROACH_ENTER_M) setMode("approach");
    } else if (mode === "approach") {
      if (dockingAvailable && tarDistance <= HUD_ENTER_M)
        setMode("docking-hud");
      else if (tarDistance > APPROACH_EXIT_M) setMode("tracking");
    } else if (mode === "docking-hud") {
      // Left the docking scenario (port deselected / lost the free port) or
      // backed out of HUD range: fall back to the approach view.
      if (!dockingAvailable || tarDistance > HUD_EXIT_M) setMode("approach");
    }
  }, [
    autoSwitch,
    dockable,
    dockingAvailable,
    tarDistance,
    mode,
    targetReading.state,
  ]);

  // Age of the observation behind this reading, measured against the FRAME's
  // view time and nothing else. `Date.now()` is the available wrong answer: it
  // lets two reads within one frame disagree about how old the same sample is,
  // which is the bug class `FrameToken` exists to prevent.
  const targetObservedUt = observedAt(targetReading);
  const ageSec =
    universalTime !== undefined && targetObservedUt
      ? Math.max(
          0,
          value("ut", universalTime).minus(targetObservedUt).magnitude,
        )
      : undefined;

  if (targetReading.state === "pending") {
    return (
      <TargetPanel badgeContext={badgeContext}>
        <EmptyState>Waiting for target telemetry</EmptyState>
      </TargetPanel>
    );
  }

  // Confirmed absence. The wire states it as a tombstone for the whole record
  // (`absent`), which is what the mod sends when the target is cleared:
  // `KspHost.BuildTarget` returns null before `name` is read, and `TargetTopic`
  // is declared `absenceIsData`.
  //
  // `tarName === undefined` is kept alongside it as a belt-and-braces guard for a
  // record that somehow arrives without a name. It is not a second encoding of
  // absence: an earlier version of this comment claimed KSP had one, a
  // "No Target Selected." sentinel, and that was wrong. It was the OLD data
  // source's string, unproducible since that source was retired, and the
  // client-side translator for it has been deleted.
  //
  // A confirmed absence can itself go old, which is what the age says: with the
  // link down, "no target set" stops being a claim about now.
  if (targetReading.state === "absent" || tarName === undefined) {
    // "Confirmed" only while we are still hearing from the craft. Once we are
    // not, the absence is itself an old observation and saying "confirmed"
    // would overstate it.
    const confirmedWord =
      targetReading.state === "observed" || targetReading.state === "absent"
        ? "confirmed"
        : "last seen";
    return (
      <TargetPanel badgeContext={badgeContext}>
        <EmptyState>
          {/* Stacked, not inline: `ReadoutCaption` is a span, so as a sibling
              of the bare text it ran together into one accessible string
              ("No target set in KSPconfirmed 0s ago"), which is how a screen
              reader would have read it out. */}
          <Stack gap="xs">
            <span>No target set in KSP</span>
            {ageSec !== undefined && (
              <ReadoutCaption>
                {confirmedWord} {formatDuration(ageSec)} ago
              </ReadoutCaption>
            )}
          </Stack>
        </EmptyState>
      </TargetPanel>
    );
  }

  // Size-aware degrades: docking + approach modes ignore widget size when
  // choosing which view to enter (distance-driven) but the rendered chrome
  // needs to back off when the slot is small.
  const rows = h ?? 5;
  const cols = w ?? 6;

  if (mode === "docking-hud") {
    return (
      <DockingHud
        name={tarName}
        distance={dockingDistance}
        relVel={dockingRelVel}
        ax={dockAx}
        ay={dockAy}
        az={dockAz}
        x={dockX}
        y={dockY}
        forwardDot={dockForwardDot?.magnitude}
        showCamera={hudMode === "hud-with-camera"}
        cameraFlightId={config?.cameraFlightId}
        cols={cols}
        rows={rows}
      />
    );
  }

  if (mode === "approach") {
    return (
      <ApproachHud
        name={tarName}
        distance={tarDistance}
        relVel={relVel}
        closestApproachUT={
          typeof closestApproachUT === "number" ? closestApproachUT : null
        }
        universalTime={typeof universalTime === "number" ? universalTime : null}
        alignmentWithheld={
          alignmentWithheld ? { ageSec: dockAgeSec } : undefined
        }
        cols={cols}
        rows={rows}
      />
    );
  }

  // Tracking mode: selectively render auxiliary readouts as height shrinks.
  const showSubReadout =
    rows >= 5 && relVel !== undefined && Number.isFinite(relVel);
  const showTargetName = rows >= 4 || cols >= 5;

  // Out of contact, either way. The two arms differ in what they let us DRAW,
  // which is why they are arms; they agree that the headline number is an
  // observation rather than a reading of now, which is why they share a tone.
  const outOfContact =
    targetReading.state === "stale" || targetReading.state === "reckonable";
  // Pulled here, in the branch that renders it, so a modelled number can only
  // reach the screen through code that says it is modelling. `withoutReckoning`
  // is the alternative and would be wrong for this widget: range to a target is
  // exactly the quantity an approach is flown on.
  const reckoned =
    targetReading.state === "reckonable" ? targetReading.reckoned : undefined;
  // Derived exactly as the observed distance is, from the same Vec3 field, so a
  // modelled range and an observed one are the same quantity computed the same
  // way. A model that returns a payload with no relative position has nothing
  // to say about range, and renders nothing rather than a zero.
  const reckonedRelPos =
    reckoned?.value.relativePosition && bare(reckoned.value.relativePosition);
  const reckonedDistance = reckonedRelPos
    ? vecMagnitude(reckonedRelPos)
    : undefined;

  return (
    <TargetPanel badgeContext={badgeContext}>
      <Stack
        gap="sm"
        style={{ flex: 1, justifyContent: "center", minHeight: 0 }}
      >
        {showTargetName && (
          <Text tone="default" size="sm" style={{ letterSpacing: "0.05em" }}>
            {tarName}
          </Text>
        )}
        {tarDistance === undefined ? (
          <DisplayDash />
        ) : (
          <Text
            tone={outOfContact ? "muted" : "accent"}
            style={DISPLAY_VALUE_STYLE}
          >
            <Unit value={value("m", tarDistance)} />
          </Text>
        )}
        {/* The caveat belongs on the value, not in the panel chrome: a header
            badge beside a confident readout is what the operator reads past.
            Only rendered out of contact, deliberately: under a light-time delay
            every value is old, so a caveat on all of them would say nothing. */}
        {outOfContact && (
          <ReadoutCaption role="status">
            at last contact
            {ageSec !== undefined && `, ${formatDuration(ageSec)} ago`}
          </ReadoutCaption>
        )}
        {reckoned !== undefined && reckonedDistance !== undefined && (
          <ReadoutCaption>
            reckoned <Unit value={value("m", reckonedDistance)} /> (
            {reckoned.basis})
          </ReadoutCaption>
        )}
        {showSubReadout && (
          <Text
            size="xs"
            tone="muted"
            style={{ marginTop: "var(--space-4)", letterSpacing: "0.04em" }}
          >
            Δv <Unit value={value("m/s", relVel as number)} decimals={2} />
          </Text>
        )}
      </Stack>
    </TargetPanel>
  );
}

/**
 * The widget's own panel chrome, shared by every branch so the badges slot and
 * the title cannot drift between them. Extracted when the single absence branch
 * became four: three of them are absence-or-caveat renderings and one is the
 * ordinary body, and duplicating the header four times was how the copy would
 * have gone out of step.
 */
function TargetPanel({
  badgeContext,
  children,
}: {
  badgeContext: DistanceToTargetBadgeContext;
  children: ReactNode;
}) {
  return (
    <Panel
      panelTitle="TARGET"
      panelAside={
        <AugmentSlot name="distance-to-target.badges" props={badgeContext} />
      }
    >
      {children}
    </Panel>
  );
}

/* Display tier. The type scale deliberately stops at --font-size-lg (16px);
   everything above it in this codebase is a fluid clamp, a JS-computed fit
   or a size locked to a box width, so a fixed rung would freeze behaviour
   rather than name it. DisplayDash below must stay equal to this. */
const DISPLAY_VALUE_STYLE = {
  fontSize: 22,
  fontWeight: 600,
  letterSpacing: "0.02em",
  lineHeight: "var(--line-height-tight)",
} as const;

/**
 * Same display tier as the value it stands in for (see `DISPLAY_VALUE_STYLE`),
 * shown while a distance hasn't arrived yet.
 */
function DisplayDash() {
  return (
    <span
      style={{
        fontSize: 22,
        fontWeight: 600,
        color: "var(--color-border-strong)",
      }}
    >
      {NULL_DISPLAY}
    </span>
  );
}

// ── Approach HUD ──────────────────────────────────────────────────────────────

interface ApproachHudProps {
  name: string;
  distance: number | undefined;
  relVel: number | undefined;
  closestApproachUT: number | null;
  universalTime: number | null;
  /**
   * Set when a docking pairing is still selected but its geometry stopped being
   * current, so the docking HUD was withheld rather than never having been
   * available. Carries the age of the last dock observation where there is one,
   * so the notice can date itself.
   */
  alignmentWithheld?: { ageSec: number | undefined };
  cols: number;
  rows: number;
}

/** A `label` / `value` pair for the approach + docking-HUD readout grids. */
function ReadoutRow({
  label,
  tone,
  children,
}: {
  label: string;
  tone?: "ok" | "warn";
  children: ReactNode;
}) {
  return (
    <>
      <ReadoutCaption
        style={{
          alignSelf: "baseline",
          whiteSpace: "nowrap",
          letterSpacing: "0.1em",
        }}
      >
        {label}
      </ReadoutCaption>
      <Text
        size="lg"
        tone={tone === "ok" ? "accent" : "default"}
        style={{
          fontWeight: 600,
          whiteSpace: "nowrap",
          color: tone === "warn" ? "var(--color-status-warning-bg)" : undefined,
        }}
      >
        {children}
      </Text>
    </>
  );
}

/**
 * Why the docking HUD is not on screen while a pairing is still selected.
 *
 * A missing reticle says nothing on its own: the HUD looks the same whether the
 * target stopped being a docking port or the dock channel went quiet, and only
 * the second is a link problem. So the withholding is stated in words, dated off
 * the last dock observation where there is one.
 */
function AlignmentWithheldNotice({ ageSec }: { ageSec: number | undefined }) {
  return (
    <ReadoutCaption role="status">
      Docking alignment no longer current
      {ageSec !== undefined && `, last seen ${formatDuration(ageSec)} ago`}
    </ReadoutCaption>
  );
}

/**
 * Approach mode: between the long-range tracking readout and the docking
 * HUD. Vessels in the 100 m – 5 km band are too close to be a "tracking"
 * problem and too far to align in the reticle. The relevant numbers are
 * closing rate + time to closest approach.
 *
 * `relVel` reads as positive when the gap is opening, negative when
 * closing: keep that convention so it matches `tar.o.relativeVelocity`'s
 * sign in the rest of the codebase.
 */
function ApproachHud({
  name,
  distance,
  relVel,
  closestApproachUT,
  universalTime,
  alignmentWithheld,
  cols,
  rows,
}: ApproachHudProps) {
  // Narrow widget: the "Closing rate" label wraps and the TCA value
  // ("T−02:05") clips at the right edge in the auto/1fr grid. Stack
  // labels above values so each value gets the full inner width.
  // Threshold is `< 6`: at exactly 5 cols (the tall-narrow portrait
  // extreme) the auto label column eats so much width that the closing
  // -rate value "−4.7 m/s" loses its trailing "s" off the right edge.
  // 6-col and wider keep the paired label/value layout.
  const stack = cols < 6;
  const closing = relVel !== undefined && Number.isFinite(relVel) && relVel < 0;
  const closingMagnitude =
    relVel !== undefined && Number.isFinite(relVel) ? Math.abs(relVel) : null;

  // o.closestTgtApprUT can come back as NaN when no encounter is predicted.
  const tcaSeconds =
    closestApproachUT !== null &&
    universalTime != null &&
    Number.isFinite(universalTime)
      ? closestApproachUT - universalTime
      : null;

  // Tiniest reachable size (minSize h=4): the stacked label/value grid is
  // six lines tall and overflows the box, the closing-rate value and TCA
  // get clipped off the bottom edge. Mirror the tracking-tiny layout (the
  // distance is the headline, since it's the widget's name) and fold
  // closing rate into a one-line subreadout. TCA is the most derived value
  // and is the cut space forces here.
  if (rows < 5) {
    return (
      <Panel panelTitle="APPROACH">
        <Stack
          gap="sm"
          style={{ flex: 1, justifyContent: "center", minHeight: 0 }}
        >
          <Text tone="default" size="sm" style={{ letterSpacing: "0.05em" }}>
            {name}
          </Text>
          {distance === undefined ? (
            <DisplayDash />
          ) : (
            <Text tone="accent" style={DISPLAY_VALUE_STYLE}>
              <Unit value={value("m", distance)} />
            </Text>
          )}
          {closingMagnitude !== null && (
            <Text
              size="xs"
              tone="muted"
              style={{ marginTop: "var(--space-4)", letterSpacing: "0.04em" }}
            >
              {closing ? "−" : "+"}
              <Unit value={value("m/s", closingMagnitude)} decimals={1} />
            </Text>
          )}
          {alignmentWithheld && (
            <AlignmentWithheldNotice ageSec={alignmentWithheld.ageSec} />
          )}
        </Stack>
      </Panel>
    );
  }

  return (
    <Panel panelTitle="APPROACH">
      <Text tone="default" size="sm" style={{ letterSpacing: "0.05em" }}>
        {name}
      </Text>
      <Grid
        cols={stack ? "1fr" : "auto 1fr"}
        gap="lg"
        style={{
          marginTop: "var(--space-6)",
          rowGap: stack ? "0" : "var(--space-4)",
        }}
      >
        <ReadoutRow label="Distance">
          {distance === undefined ? (
            NULL_DISPLAY
          ) : (
            <Unit value={value("m", distance)} />
          )}
        </ReadoutRow>

        <ReadoutRow
          label="Closing rate"
          tone={closingMagnitude === null ? undefined : closing ? "ok" : "warn"}
        >
          {closingMagnitude === null ? (
            NULL_DISPLAY
          ) : (
            <>
              {closing ? "−" : "+"}
              <Unit value={value("m/s", closingMagnitude)} decimals={1} />
            </>
          )}
        </ReadoutRow>

        <ReadoutRow label="TCA">
          {tcaSeconds === null ? (
            NULL_DISPLAY
          ) : (
            <Countdown value={tcaSeconds} clock precise />
          )}
        </ReadoutRow>
      </Grid>
      {alignmentWithheld && (
        <AlignmentWithheldNotice ageSec={alignmentWithheld.ageSec} />
      )}
    </Panel>
  );
}

// ── Docking HUD ───────────────────────────────────────────────────────────────

interface DockingHudProps {
  name: string;
  distance: number | undefined;
  relVel: number | undefined;
  ax: number | undefined;
  ay: number | undefined;
  az: number | undefined;
  x: number | undefined;
  y: number | undefined;
  /**
   * `vessel.dock.forwardDot`: cosine of the angle between the two ports'
   * forward vectors (1 = perfectly aligned). When present this is a more
   * direct alignment signal than the derived `ax`/`ay` angle heuristic
   * below and takes priority for the reticle's aligned/misaligned tint.
   */
  forwardDot: number | undefined;
  showCamera: boolean;
  cameraFlightId: number | null | undefined;
  cols: number;
  rows: number;
}

/** Fixed crosshair through the HUD centre: two hairline rules, no pseudo-elements. */
function Crosshair() {
  const line = {
    position: "absolute" as const,
    background: "rgba(0, 255, 136, 0.75)",
  };
  return (
    <div
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      aria-hidden="true"
    >
      <div
        style={{
          ...line,
          left: 0,
          right: 0,
          top: "50%",
          height: 1,
          transform: "translateY(-0.5px)",
        }}
      />
      <div
        style={{
          ...line,
          top: 0,
          bottom: 0,
          left: "50%",
          width: 1,
          transform: "translateX(-0.5px)",
        }}
      />
    </div>
  );
}

/** Target reticle drifting in proportion to the docking alignment angles. */
function Reticle({
  aligned,
  left,
  top,
}: {
  aligned: boolean;
  left: string;
  top: string;
}) {
  return (
    <div
      style={{
        position: "absolute",
        width: 22,
        height: 22,
        border: `2px solid ${aligned ? "var(--color-accent-fg)" : "var(--color-status-warning-bg)"}`,
        borderRadius: "var(--radius-circle)",
        transform: "translate(-50%, -50%)",
        // left/top are an instant telemetry chase (the reticle follows a live
        // target), so they use --duration-instant/--ease-linear rather than an
        // eased hover rung. Only the border-colour change is a slower UI cue.
        transition:
          "left var(--duration-instant) var(--ease-linear), top var(--duration-instant) var(--ease-linear), border-color var(--duration-base) var(--ease-linear)",
        // Ring only: centre stays transparent so the crosshair stays visible.
        boxShadow: `0 0 6px ${aligned ? "rgba(0,255,136,0.6)" : "rgba(255,152,0,0.5)"}`,
        left,
        top,
      }}
    />
  );
}

/* The two tick helpers below are all derived geometry and stay off the
   scales: the 1px is a hairline rule (a drawn line, not spacing), the 8px
   is the tick's own length, and each translate is exactly half that length,
   centring the tick on the crosshair. They must track the tick size, not a
   spacing rung. */
function HorizTick({ left }: { left: string }) {
  return (
    <div
      style={{
        position: "absolute",
        background: "rgba(0, 255, 136, 0.35)",
        pointerEvents: "none",
        top: "50%",
        width: 1,
        height: 8,
        transform: "translateY(-4px)",
        left,
      }}
    />
  );
}

function VertTick({ top }: { top: string }) {
  return (
    <div
      style={{
        position: "absolute",
        background: "rgba(0, 255, 136, 0.35)",
        pointerEvents: "none",
        left: "50%",
        height: 1,
        width: 8,
        transform: "translateX(-4px)",
        top,
      }}
    />
  );
}

/**
 * Compact docking HUD: a fixed crosshair with the target reticle drifting
 * in proportion to the docking alignment angles. `dock.ax` / `dock.ay` are in
 * degrees; we map them into the visible box at ~8° = edge, so small angles
 * are visible but extreme misalignment clamps instead of sailing off-screen.
 */
function DockingHud(props: DockingHudProps) {
  const {
    name,
    distance,
    relVel,
    ax,
    ay,
    az,
    x,
    y,
    forwardDot,
    showCamera,
    cameraFlightId,
    cols,
    rows,
  } = props;

  // Wide + short (e.g. 18×5): too few rows for the vertical
  // viewport-over-overlay stack, but plenty of horizontal room. Flow to a
  // row layout: reticle on the left, readout panel beside it on the right;
  // instead of dropping the reticle entirely.
  const wideShort = cols >= 12 && rows < 6;
  // Tiny widget: the viewport collapses to near-zero height after the
  // overlay takes its share, so the reticle clips at the top edge and
  // becomes useless. Drop it entirely and let the numeric readouts fill
  // the slot. In the wide-short row layout the viewport gets its height
  // from the full panel height, so it's kept there even at rows < 6.
  const showViewport = wideShort || (rows >= 6 && cols >= 4);
  // Narrow widget: HudGrid auto/1fr columns can't hold "0.12 m / -0.07 m"
  // or "0.3° · -0.2° · 0.8°" without wrapping. Stack so each readout
  // owns the row width.
  const stackReadouts = cols < 5;
  // Tiniest reachable size (3×4 minSize): even stacked, "0.12 m / -0.07 m"
  // still overflows a ~70 px content area. Drop the X/Y and α/β/γ
  // detail rows here: Δv alone is the headline closing/opening cue and
  // the precision-instruments view is reserved for compact and above.
  const showAlignmentDetail = cols >= 4;

  // Angular mapping to HUD coords. Clamp beyond ±8° so the reticle stays
  // inside the visible box: past that the pilot isn't docking, they're
  // reorienting.
  const MAX_DEG = 8;
  const axClamped =
    ax === undefined ? 0 : Math.max(-MAX_DEG, Math.min(MAX_DEG, ax));
  const ayClamped =
    ay === undefined ? 0 : Math.max(-MAX_DEG, Math.min(MAX_DEG, ay));
  // 0..1 offsets from centre, -1..1. -ay puts "nose up" at top.
  const dx = axClamped / MAX_DEG;
  const dy = -ayClamped / MAX_DEG;

  // forwardDot (cosine of port-forward-vector angle) is the more direct
  // alignment signal when available: 0.9998 ~= within ~1° of dead-on,
  // matching the derived-angle heuristic's < 1° threshold below.
  const aligned =
    forwardDot !== undefined
      ? forwardDot > 0.9998
      : ax !== undefined &&
        ay !== undefined &&
        Math.abs(ax) < 1 &&
        Math.abs(ay) < 1;

  // Closing if relVel is negative (standard KSP convention: positive = opening).
  const closing = relVel !== undefined && Number.isFinite(relVel) && relVel < 0;

  // Overlay/camera slot context: the reticle coordinate frame an augment needs
  // to draw in the HUD's own space. `reticleTravelPct` (40) is the
  // `50 + dx·40 %` factor the built-in reticle uses, so an augment marker at
  // `50 + offset·reticleTravelPct` % lands in the same space.
  const hudContext: DistanceToTargetHudContext = {
    maxDeg: MAX_DEG,
    reticleOffset: { x: dx, y: dy },
    reticleTravelPct: 40,
    aligned,
    ax,
    ay,
    distance,
    cameraFlightId,
  };

  return (
    <Box
      surface="app"
      radius="xs"
      role="region"
      aria-label={`Docking HUD for ${name}`}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: wideShort ? "row" : "column",
        overflow: "hidden",
      }}
    >
      {/* Camera-backdrop slot: an augment draws a video layer behind the
          reticle, in the HUD's space. Gated on `showCamera` (the "HUD only
          (no video)" variant must stay video-free) and on `showViewport`
          (too small to be worth a backdrop), the same two conditions the
          built-in HudCamera this slot replaced was gated on. */}
      {showCamera && showViewport && (
        <AugmentSlot name="distance-to-target.camera" props={hudContext} />
      )}
      {showViewport && (
        <div
          style={{
            position: "relative",
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            // Subtle green tint over the video to sell the instrument feel.
            background:
              "radial-gradient(circle at center, rgba(0, 255, 136, 0.08) 0%, rgba(0, 0, 0, 0.3) 70%)",
          }}
        >
          {/* Fixed centre crosshair */}
          <Crosshair />
          {/* Reticle driven by alignment angles */}
          <Reticle
            aligned={aligned}
            left={`${50 + dx * 40}%`}
            top={`${50 + dy * 40}%`}
          />
          {/* Axis ticks: give the pilot a sense of scale */}
          <HorizTick left="10%" />
          <HorizTick left="30%" />
          <HorizTick left="70%" />
          <HorizTick left="90%" />
          <VertTick top="10%" />
          <VertTick top="30%" />
          <VertTick top="70%" />
          <VertTick top="90%" />
          {/* Alignment-marker overlay slot: composable augments draw
              on top of the reticle in the same coordinate frame via `hudContext`. */}
          <AugmentSlot name="distance-to-target.overlay" props={hudContext} />
        </div>
      )}

      <div
        style={{
          padding: "var(--space-6) var(--space-10) var(--space-8)",
          background: "rgba(0, 0, 0, 0.55)",
          // Wide-short row layout docks the overlay to the side: fixed-width
          // right column with a left divider instead of the full-width bottom
          // bar. Centre it vertically so it reads as a paired panel.
          ...(wideShort
            ? {
                flex: "0 0 240px",
                alignSelf: "stretch",
                display: "flex",
                flexDirection: "column" as const,
                justifyContent: "center",
                borderLeft: "1px solid rgba(0, 255, 136, 0.2)",
              }
            : {
                borderTop: "1px solid rgba(0, 255, 136, 0.2)",
              }),
        }}
      >
        <Cluster
          justify="between"
          align="baseline"
          style={{ gap: "var(--space-10)" }}
        >
          <Truncate
            style={{
              fontSize: "var(--font-size-sm)",
              color: "var(--color-status-go-fg)",
              letterSpacing: "0.04em",
            }}
          >
            {name}
          </Truncate>
          <Text
            size="lg"
            tone="accent"
            style={{ fontWeight: 700, whiteSpace: "nowrap" }}
          >
            {distance === undefined ? (
              NULL_DISPLAY
            ) : (
              <Unit value={value("m", distance)} />
            )}
          </Text>
        </Cluster>
        <Grid
          cols={stackReadouts ? "1fr" : "auto 1fr"}
          gap="md"
          style={{ rowGap: "var(--space-hair)", marginTop: "var(--space-4)" }}
        >
          <ReadoutCaption
            style={{
              color: "var(--color-status-go-fg)",
              letterSpacing: "0.12em",
              whiteSpace: "nowrap",
            }}
          >
            Δv
          </ReadoutCaption>
          <Text
            style={{
              fontSize: 11,
              whiteSpace: "nowrap",
              color: closing
                ? "var(--color-accent-fg)"
                : "var(--color-status-warning-bg)",
            }}
          >
            {relVel === undefined || !Number.isFinite(relVel) ? (
              NULL_DISPLAY
            ) : (
              <Unit value={value("m/s", relVel)} decimals={2} />
            )}
          </Text>

          {showAlignmentDetail && (
            <>
              <ReadoutCaption
                style={{
                  color: "var(--color-status-go-fg)",
                  letterSpacing: "0.12em",
                  whiteSpace: "nowrap",
                }}
              >
                X/Y
              </ReadoutCaption>
              <Text
                style={{
                  fontSize: 11,
                  whiteSpace: "nowrap",
                  color: "var(--color-status-go-fg)",
                }}
              >
                {x === undefined ? (
                  NULL_DISPLAY
                ) : (
                  <Unit value={value("m", x)} decimals={2} />
                )}{" "}
                /{" "}
                {y === undefined ? (
                  NULL_DISPLAY
                ) : (
                  <Unit value={value("m", y)} decimals={2} />
                )}
              </Text>

              <ReadoutCaption
                style={{
                  color: "var(--color-status-go-fg)",
                  letterSpacing: "0.12em",
                  whiteSpace: "nowrap",
                }}
              >
                α/β/γ
              </ReadoutCaption>
              <Text
                style={{
                  fontSize: 11,
                  whiteSpace: "nowrap",
                  color: "var(--color-status-go-fg)",
                }}
              >
                {ax === undefined ? (
                  NULL_DISPLAY
                ) : (
                  <Unit value={value("°", ax)} decimals={1} />
                )}{" "}
                ·{" "}
                {ay === undefined ? (
                  NULL_DISPLAY
                ) : (
                  <Unit value={value("°", ay)} decimals={1} />
                )}{" "}
                ·{" "}
                {az === undefined ? (
                  NULL_DISPLAY
                ) : (
                  <Unit value={value("°", az)} decimals={1} />
                )}
              </Text>
            </>
          )}
        </Grid>
      </div>
    </Box>
  );
}

// ── Config component ──────────────────────────────────────────────────────────

function DistanceToTargetConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<DistanceToTargetConfig>>) {
  const [autoSwitch, setAutoSwitch] = useState(config?.autoSwitch !== false);
  const [hudMode, setHudMode] = useState<DockingHudMode>(
    config?.hudMode ?? "hud-with-camera",
  );
  // Carried through untouched rather than edited here. The camera PICKER left
  // with the built-in HudCamera: listing and labelling cameras needs a camera
  // mod's SDK, and this widget deliberately no longer depends on one. The
  // augment that fills `distance-to-target.camera` now selects the camera
  // itself: for a DOCKING HUD it can identify the actual docking camera,
  // which is strictly better than the manual pick this replaced (that existed
  // only because nothing could tell docking cameras apart). An operator who
  // had pinned a camera keeps it: the value still round-trips through config
  // and reaches the augment via `DistanceToTargetHudContext`, which honours it
  // as an override.
  const pinnedCameraId = config?.cameraFlightId;

  const candidate = useMemo<DistanceToTargetConfig>(
    () => ({
      autoSwitch,
      hudMode,
      cameraFlightId: pinnedCameraId ?? undefined,
    }),
    [autoSwitch, hudMode, pinnedCameraId],
  );

  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });

  return (
    <ConfigForm>
      <Field>
        <Switch
          checked={autoSwitch}
          onChange={setAutoSwitch}
          label="Auto-switch to docking HUD under 100 m"
        />
        <FieldHint>
          Triggers only when the target is a vessel or docking port, not a
          celestial body.
        </FieldHint>
      </Field>
      <Field>
        <FieldLabel htmlFor="dtt-hud-mode">HUD variant</FieldLabel>
        <Select
          id="dtt-hud-mode"
          value={hudMode}
          onChange={(e) => setHudMode(e.target.value as DockingHudMode)}
        >
          <option value="hud-with-camera">HUD over camera stream</option>
          <option value="hud">HUD only (no video)</option>
        </Select>
        <FieldHint>
          The camera view needs a camera mod installed. Its docking camera is
          picked automatically for the backdrop.
        </FieldHint>
      </Field>
    </ConfigForm>
  );
}

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<DistanceToTargetConfig>({
  id: "distance-to-target",
  name: "Distance to Target",
  description:
    "Target name + distance, with an auto-switching docking HUD (crosshair + alignment reticle + optional camera backdrop) when closing on a vessel or docking port.",
  tags: ["telemetry", "rendezvous"],
  defaultSize: { w: 6, h: 9 },
  minSize: { w: 3, h: 4 },
  component: DistanceToTargetComponent,
  configComponent: DistanceToTargetConfigComponent,
  dataRequirements: ["vessel.target", "vessel.dock"],
  defaultConfig: { autoSwitch: true, hudMode: "hud-with-camera" },
  augmentSlots: [
    "distance-to-target.camera",
    "distance-to-target.overlay",
    "distance-to-target.badges",
  ],
  pushable: true,
  requires: ["flight"],
});

export { DistanceToTargetComponent };
