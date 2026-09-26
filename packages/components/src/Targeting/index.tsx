import type { ComponentProps, ConfigComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  defineTopicManifest,
  registerComponent,
} from "@ksp-gonogo/core";
import {
  observedAt,
  useViewUt,
  withoutReckoning,
} from "@ksp-gonogo/sitrep-client";
import {
  type ReckoningBasis,
  stillTrue,
  TargetKind,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Cluster,
  ConfigForm,
  Countdown,
  EmptyState,
  Field,
  FieldHint,
  FieldLabel,
  FramedDisplay,
  Grid,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  Section,
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
  closingRateReading,
  deriveDockAngles,
  radialSpeed,
  rangeReading,
  vecMagnitude,
} from "../shared/dockAngles";
import { magnitudeOf } from "../shared/magnitude";

// Side-effect import: registers the `vessel.target` reckoner (stubbed, so it declines) and its processor.

const topics = defineTopicManifest({
  channels: ["vessel.target", "vessel.dock"],
});

type DockingHudMode = "hud" | "hud-with-camera";

interface TargetingConfig {
  /** Auto-switch to the docking HUD when a vessel or port target closes under the approach threshold. Default true. */
  autoSwitch?: boolean;
  /** Which HUD variant auto-switch promotes to. Default "hud-with-camera". */
  hudMode?: DockingHudMode;
  /**
   * Camera id pinning the video backdrop, unset to let the filling augment
   * choose. Opaque here and passed straight through via `TargetingHudContext`.
   */
  cameraFlightId?: number | null;
}

/*
 * Two docking-HUD overlay slots receive the HUD's reticle frame:
 * `targeting.camera` (a camera Uplink's video backdrop; this widget decides
 * WHETHER one shows, the augment WHICH camera, and there is deliberately no
 * built-in) and `targeting.overlay` (alignment markers over the reticle,
 * composable by priority).
 */

/** The HUD's reticle-space context, passed to both the camera and overlay slots. */
export interface TargetingHudContext {
  /** Half-range in degrees the reticle box maps to; the reticle clamps at the edge. */
  maxDeg: number;
  /** Reticle-centre offset from HUD centre, each component in -1..1; `y` is flipped so positive is downward. */
  reticleOffset: { x: number; y: number };
  /** Percent of the half-box the reticle travels per unit of `reticleOffset`: a marker at `50 + offset·reticleTravelPct` % sits in the same space. */
  reticleTravelPct: number;
  /** True while the two ports are within docking-alignment tolerance. */
  aligned: boolean;
  /** Raw docking alignment angles in degrees; undefined outside a docking scenario. */
  ax: number | undefined;
  ay: number | undefined;
  /** Range to the target in metres; undefined until the stream reports position. */
  distance: number | undefined;
  /** Camera id the operator pinned, or unset to let the augment choose. */
  cameraFlightId: number | null | undefined;
}

// Declaration-merge the slot ids onto their props types in core's `SlotRegistry`.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "targeting.camera": TargetingHudContext;
    "targeting.overlay": TargetingHudContext;
  }
}

// Distances in metres; hysteresis prevents strobing at the thresholds.
const HUD_ENTER_M = 100;
const HUD_EXIT_M = 150;
const APPROACH_ENTER_M = 5_000;
const APPROACH_EXIT_M = 5_500;

type ViewMode = "tracking" | "approach" | "docking-hud";

function TargetingComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<TargetingConfig>>) {
  const autoSwitch = config?.autoSwitch !== false;
  const hudMode: DockingHudMode = config?.hudMode ?? "hud-with-camera";

  /*
   * `vessel.target` is a Reading, so a dropped link can never render "No
   * target set". `vessel.dock` splits per FIELD: the pairing is a fact, while
   * the geometry (reticle, alignment, closing rate) is read as "fly this, now"
   * and stops being drawn once it is not current. Its `absent` and `pending`
   * both mean no HUD.
   */
  const targetReading = topics.useTelemetry("vessel.target");
  const dockReading = topics.useTelemetry("vessel.dock");
  // `vessel.dock` is reckonable: the modelled separation overlays the observation, while relative velocity and `forwardDot` do not move.
  // The observation first: `reckoning.status` narrows the reckoning, not the arm carrying it.
  const dockObserved =
    dockReading.state === "observed" || dockReading.state === "stale"
      ? dockReading.value
      : undefined;
  const dock =
    dockObserved && dockReading.reckoning.status === "available"
      ? { ...dockObserved, ...dockReading.reckoning.value }
      : dockReading.state === "observed"
        ? dockReading.value
        : undefined;
  /**
   * Observation-only scalars for the client-side arithmetic (distance, closing
   * rate, dock angles). Every readout still branches on the reading's own state
   * for its caption and age.
   */
  const dockPairing = stillTrue(withoutReckoning(dockReading), undefined);
  const target = stillTrue(withoutReckoning(targetReading), undefined);

  const tarName = target?.name;
  const tarKind = target?.kind;
  // Closest approach is mod-side, off the elected propagation provider; the view-UT is "now".
  const closestApproachUT = magnitudeOf(target?.closestApproach?.time);
  // Unwrapped: the guards below use `typeof`/`Number.isFinite`, which answer NO for a wrapped value.
  const universalTime = useViewUt()?.magnitude;

  const tarRelPos = target?.relativePosition && bare(target.relativePosition);
  const tarRelVelVec =
    target?.relativeVelocity && bare(target.relativeVelocity);
  // Undefined when there is no docking scenario OR the geometry is not current; `alignmentWithheld` tells those apart.
  const dockRelPos = dock?.relativePosition && bare(dock.relativePosition);
  const dockRelVelVec = dock?.relativeVelocity && bare(dock.relativeVelocity);
  const dockDistanceStream = dock?.distance?.magnitude;
  const dockForwardDot = dock?.forwardDot;

  const tarDistance = tarRelPos ? vecMagnitude(tarRelPos) : undefined;
  const relVel =
    tarRelPos && tarRelVelVec
      ? radialSpeed(tarRelPos, tarRelVelVec)
      : undefined;
  // The plain numbers drive the mode machine and guards; these are what the readouts draw, so a held range is marked.
  const rangeR = rangeReading(targetReading.relativePosition);
  const closingRateR = closingRateReading(
    targetReading.relativePosition,
    targetReading.relativeVelocity,
  );
  const derivedDockAngles = dockRelPos
    ? deriveDockAngles(dockRelPos)
    : undefined;
  const dockAx = derivedDockAngles?.ax;
  const dockAy = derivedDockAngles?.ay;
  // Docking-port roll is not on the wire, so the third axis renders NULL_DISPLAY.
  const dockAz: number | undefined = undefined;
  const dockX = dockRelPos?.x;
  const dockY = dockRelPos?.y;
  const derivedDockRelVel =
    dockRelPos && dockRelVelVec
      ? radialSpeed(dockRelPos, dockRelVelVec)
      : undefined;
  // The docking HUD's Δv row prefers the port-to-port closing rate.
  const dockingRelVel = derivedDockRelVel ?? relVel;
  const dockingDistance = dockDistanceStream ?? tarDistance;

  // Sticky, with a smaller window to enter than to exit.
  const [mode, setMode] = useState<ViewMode>("tracking");

  // A real non-body target, read off the ORDINAL: drives the APPROACH view.
  const dockable =
    tarKind !== undefined &&
    tarKind !== TargetKind.Body &&
    tarName !== undefined;

  // The HUD needs `vessel.dock`, published only for a port target with a free port on our side; distance alone would draw a dead reticle.
  const dockingAvailable = dockRelPos !== undefined;

  /*
   * The pairing is still selected but its geometry is no longer current, so the
   * reticle is WITHHELD, which looks identical to a target that stopped being a
   * port. The reckoning arm is excluded: a modelled reticle is drawn under its
   * own caption, and never with neither.
   */
  const alignmentWithheld =
    dockReading.state === "stale" &&
    dockReading.reckoning.status !== "available" &&
    dockPairing?.relativePosition !== undefined;
  // The separation is being carried forward, so the HUD says its geometry is modelled.
  const modelledAlignment =
    dockReading.reckoning.status === "available" &&
    dockReading.state === "stale"
      ? dockReading.reckoning.basis
      : undefined;
  // Ages are game-time `value("s", ...)` off the frame's view-UT, clamped at zero since samples arrive out of order.
  const dockObservedUt = observedAt(dockReading);
  const dockAge =
    universalTime !== undefined && dockObservedUt
      ? value("ut", universalTime).minus(dockObservedUt).max(0)
      : undefined;

  useEffect(() => {
    // The specialised views assert something about NOW, so anything not current falls back to tracking, which can state its age.
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
      // Left the docking scenario or backed out of HUD range.
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

  // Age measured against the FRAME's view time, never `Date.now()`, so two reads in one frame agree.
  const targetObservedUt = observedAt(targetReading);
  const age =
    universalTime !== undefined && targetObservedUt
      ? value("ut", universalTime).minus(targetObservedUt).max(0)
      : undefined;

  if (targetReading.state === "pending") {
    return (
      <TargetPanel>
        <EmptyState>Waiting for target telemetry</EmptyState>
      </TargetPanel>
    );
  }

  // Neither "not yet" nor "no target set": nothing here reports targets.
  if (targetReading.state === "unowned") {
    return (
      <TargetPanel>
        <EmptyState>No target channel on this install</EmptyState>
      </TargetPanel>
    );
  }

  /*
   * Confirmed absence: a cleared target arrives as a tombstone. `tarName ===
   * undefined` guards a record without a name. A confirmed absence can itself
   * go old, which the age says.
   */
  if (targetReading.state === "absent" || tarName === undefined) {
    // "Confirmed" only while we are still hearing from the craft.
    const confirmedWord =
      targetReading.state === "observed" || targetReading.state === "absent"
        ? "confirmed"
        : "last seen";
    return (
      <TargetPanel>
        <EmptyState>
          {/* Stacked: as siblings the text and caption ran into one accessible string. */}
          <Stack>
            <span>No target set in KSP</span>
            {age !== undefined && (
              <ReadoutCaption>
                {confirmedWord} <Unit value={age} /> ago
              </ReadoutCaption>
            )}
          </Stack>
        </EmptyState>
      </TargetPanel>
    );
  }

  // View choice is distance-driven, but the chrome still backs off in a small slot.
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
        modelled={
          modelledAlignment
            ? { basis: modelledAlignment, age: dockAge }
            : undefined
        }
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
        alignmentWithheld={alignmentWithheld ? { age: dockAge } : undefined}
        cols={cols}
        rows={rows}
      />
    );
  }

  const showSubReadout =
    rows >= 5 && relVel !== undefined && Number.isFinite(relVel);
  const showTargetName = rows >= 4 || cols >= 5;

  // Out of contact the headline is an observation, not a reading of now, and the muted tone says so.
  const outOfContact = targetReading.state === "stale";
  // Pulled here so a modelled number reaches the screen only through code that says it is modelling.
  const reckoned =
    targetReading.reckoning.status === "available"
      ? targetReading.reckoning
      : undefined;
  // Derived exactly as the observed distance is; a model with no relative position renders nothing, not a zero.
  const reckonedRelPos =
    reckoned?.value.relativePosition && bare(reckoned.value.relativePosition);
  const reckonedDistance = reckonedRelPos
    ? vecMagnitude(reckonedRelPos)
    : undefined;

  return (
    <TargetPanel>
      <Stack style={{ flex: 1, justifyContent: "center", minHeight: 0 }}>
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
            <Unit value={rangeR} />
          </Text>
        )}
        {/* The caveat sits on the value, and only out of contact: under light-time delay every value is old. */}
        {outOfContact && (
          <ReadoutCaption role="status">
            at last contact
            {age !== undefined && (
              <>
                , <Unit value={age} /> ago
              </>
            )}
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
            style={{
              marginTop: "var(--gap-sub-readout)",
              letterSpacing: "0.04em",
            }}
          >
            Δv <Unit value={closingRateR} decimals={2} />
          </Text>
        )}
      </Stack>
    </TargetPanel>
  );
}

/** The panel chrome shared by every branch, so the badges slot and title cannot drift. */
function TargetPanel({ children }: { children: ReactNode }) {
  return (
    <Panel panelTitle="TARGET" sections={<Section full>{children}</Section>} />
  );
}

// Display tier above the type scale; DisplayDash must stay equal to this.
const DISPLAY_VALUE_STYLE = {
  fontSize: 22,
  fontWeight: 600,
  letterSpacing: "0.02em",
  lineHeight: "var(--line-height-tight)",
} as const;

/** Same display tier as the value it stands in for, shown while a distance has not arrived. */
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

interface ApproachHudProps {
  name: string;
  distance: number | undefined;
  relVel: number | undefined;
  closestApproachUT: number | null;
  universalTime: number | null;
  /** A pairing is selected but its geometry is no longer current, with the age of the last dock observation. */
  alignmentWithheld?: { age: Value<"s"> | undefined };
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

/** Why the docking HUD is not on screen while a pairing is still selected, dated where possible. */
function AlignmentWithheldNotice({ age }: { age: Value<"s"> | undefined }) {
  return (
    <ReadoutCaption role="status">
      Docking alignment no longer current
      {age !== undefined && (
        <>
          , last seen <Unit value={age} /> ago
        </>
      )}
    </ReadoutCaption>
  );
}

/**
 * Approach mode, between long-range tracking and the docking HUD: the
 * 100 m-5 km band, where closing rate and time to closest approach matter.
 * `relVel` is positive when opening, negative when closing.
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
  // Below 6 cols the paired grid clips values, so labels stack above them.
  const stack = cols < 6;
  const closing = relVel !== undefined && Number.isFinite(relVel) && relVel < 0;
  const closingMagnitude =
    relVel !== undefined && Number.isFinite(relVel) ? Math.abs(relVel) : null;

  // NaN when no encounter is predicted.
  const tcaSeconds =
    closestApproachUT !== null &&
    universalTime != null &&
    Number.isFinite(universalTime)
      ? closestApproachUT - universalTime
      : null;

  // The smallest size cannot fit the stacked grid: distance is the headline and closing rate a subreadout; TCA is cut.
  if (rows < 5) {
    return (
      <Panel
        panelTitle="APPROACH"
        /* Panel measures before it centres, so an overflowing readout still starts at the top. */
        fitToSize
        sections={
          <Section full gap="related-dense">
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
                style={{
                  marginTop: "var(--gap-sub-readout)",
                  letterSpacing: "0.04em",
                }}
              >
                {closing ? "−" : "+"}
                <Unit value={value("m/s", closingMagnitude)} decimals={1} />
              </Text>
            )}
            {alignmentWithheld && (
              <AlignmentWithheldNotice age={alignmentWithheld.age} />
            )}
          </Section>
        }
      />
    );
  }

  return (
    <Panel
      panelTitle="APPROACH"
      sections={[
        <Section key="target" full>
          <Text tone="default" size="sm" style={{ letterSpacing: "0.05em" }}>
            {name}
          </Text>
        </Section>,
        <Section key="approach" full>
          <Grid
            cols={stack ? "1fr" : "auto 1fr"}
            gap="section-compact"
            style={{
              marginTop: "var(--gap-related-compact)",
              rowGap: stack ? "0" : "var(--gap-row-wrap)",
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
              tone={
                closingMagnitude === null ? undefined : closing ? "ok" : "warn"
              }
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
            <AlignmentWithheldNotice age={alignmentWithheld.age} />
          )}
        </Section>,
      ]}
    />
  );
}

interface DockingHudProps {
  name: string;
  distance: number | undefined;
  relVel: number | undefined;
  ax: number | undefined;
  ay: number | undefined;
  az: number | undefined;
  x: number | undefined;
  y: number | undefined;
  /** Cosine of the angle between the two ports' forward vectors (1 = aligned); takes priority for the reticle tint. */
  forwardDot: number | undefined;
  /** Present when the separation was carried forward rather than observed, with the basis and the observation's age. */
  modelled: { basis: ReckoningBasis; age: Value<"s"> | undefined } | undefined;
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
        // An instant telemetry chase for left/top; only the border colour eases.
        transition:
          "left var(--duration-instant) var(--ease-linear), top var(--duration-instant) var(--ease-linear), border-color var(--duration-base) var(--ease-linear)",
        // Ring only, so the crosshair stays visible.
        boxShadow: `0 0 6px ${aligned ? "rgba(0,255,136,0.6)" : "rgba(255,152,0,0.5)"}`,
        left,
        top,
      }}
    />
  );
}

// Derived tick geometry, off the spacing scale: a hairline rule and half-length translates centring the tick.
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
 * Compact docking HUD: a fixed crosshair with the target reticle drifting in
 * proportion to the alignment angles, clamped at ~8° to the box edge.
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
    modelled,
    showCamera,
    cameraFlightId,
    cols,
    rows,
  } = props;

  // Wide and short: reticle on the left, readouts beside it.
  const wideShort = cols >= 12 && rows < 6;
  // Too small for a useful reticle, except in the wide-short row layout.
  const showViewport = wideShort || (rows >= 6 && cols >= 4);
  // Narrow: the paired grid cannot hold the readouts without wrapping.
  const stackReadouts = cols < 5;
  // The smallest size keeps only Δv, the headline closing cue.
  const showAlignmentDetail = cols >= 4;

  // Past ±8° the pilot is reorienting, not docking, so the reticle clamps.
  const MAX_DEG = 8;
  const axClamped =
    ax === undefined ? 0 : Math.max(-MAX_DEG, Math.min(MAX_DEG, ax));
  const ayClamped =
    ay === undefined ? 0 : Math.max(-MAX_DEG, Math.min(MAX_DEG, ay));
  // -ay puts "nose up" at top.
  const dx = axClamped / MAX_DEG;
  const dy = -ayClamped / MAX_DEG;

  // 0.9998 is within about 1° of dead-on, matching the derived-angle threshold.
  const aligned =
    forwardDot !== undefined
      ? forwardDot > 0.9998
      : ax !== undefined &&
        ay !== undefined &&
        Math.abs(ax) < 1 &&
        Math.abs(ay) < 1;

  // Positive relVel is opening, the KSP convention.
  const closing = relVel !== undefined && Number.isFinite(relVel) && relVel < 0;

  const hudContext: TargetingHudContext = {
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
    <Panel
      role="region"
      aria-label={`Docking HUD for ${name}`}
      panelTitle="DOCKING"
      sections={
        /* One filling section: the wide-short layout needs the readouts BESIDE the viewport, hence the inline direction. */
        <Section
          full
          fill
          gap="related-dense"
          style={{ flexDirection: wideShort ? "row" : "column" }}
        >
          {showViewport && (
            /* A frame inside the padded body, which also divides the two halves. */
            <FramedDisplay style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
              {/* Gated like the video it hosts: not in the HUD-only variant, not when too small. The frame is what the augment's `inset: 0` resolves against. */}
              {showCamera && (
                <AugmentSlot name="targeting.camera" props={hudContext} />
              )}
              <div
                style={{
                  position: "relative",
                  flex: 1,
                  minHeight: 0,
                  minWidth: 0,
                  background:
                    "radial-gradient(circle at center, rgba(0, 255, 136, 0.08) 0%, rgba(0, 0, 0, 0.3) 70%)",
                }}
              >
                <Crosshair />
                <Reticle
                  aligned={aligned}
                  left={`${50 + dx * 40}%`}
                  top={`${50 + dy * 40}%`}
                />
                {/* Axis ticks give the pilot a sense of scale. */}
                <HorizTick left="10%" />
                <HorizTick left="30%" />
                <HorizTick left="70%" />
                <HorizTick left="90%" />
                <VertTick top="10%" />
                <VertTick top="30%" />
                <VertTick top="70%" />
                <VertTick top="90%" />
                <AugmentSlot name="targeting.overlay" props={hudContext} />
              </div>
            </FramedDisplay>
          )}

          <div
            style={
              /* Wide-short: a fixed-width right column, centred vertically. */
              wideShort
                ? {
                    flex: "0 0 240px",
                    alignSelf: "stretch",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                  }
                : undefined
            }
          >
            <Cluster
              justify="between"
              align="baseline"
              style={{ gap: "var(--gap-headline)" }}
            >
              <Truncate
                style={{
                  fontSize: "var(--font-size-value)",
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
              gap="label-value"
              style={{
                rowGap: "var(--gap-line)",
                marginTop: "var(--gap-sub-readout)",
              }}
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
            {modelled && (
              <ReadoutCaption role="status">
                Alignment reckoned ({modelled.basis})
                {modelled.age !== undefined && (
                  <>
                    , last seen <Unit value={modelled.age} /> ago
                  </>
                )}
              </ReadoutCaption>
            )}
          </div>
        </Section>
      }
    />
  );
}

function TargetingConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<TargetingConfig>>) {
  const [autoSwitch, setAutoSwitch] = useState(config?.autoSwitch !== false);
  const [hudMode, setHudMode] = useState<DockingHudMode>(
    config?.hudMode ?? "hud-with-camera",
  );
  // No camera picker: the augment filling `targeting.camera` picks, and a pinned id round-trips as an override.
  const pinnedCameraId = config?.cameraFlightId;

  const candidate = useMemo<TargetingConfig>(
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

registerComponent<TargetingConfig>({
  id: "targeting",
  name: "Targeting",
  description:
    "Target name + distance, with an auto-switching docking HUD (crosshair + alignment reticle + optional camera backdrop) when closing on a vessel or docking port.",
  tags: ["telemetry", "rendezvous"],
  defaultSize: { w: 6, h: 9 },
  /* Five rows: at four the overflow glow painted out the waiting hint's last word. */
  minSize: { w: 3, h: 5 },
  component: TargetingComponent,
  configComponent: TargetingConfigComponent,
  channels: topics.channels,
  defaultConfig: { autoSwitch: true, hudMode: "hud-with-camera" },
  augmentSlots: ["targeting.camera", "targeting.overlay"],
  pushable: true,
  requires: ["flight"],
});

export { TargetingComponent };
