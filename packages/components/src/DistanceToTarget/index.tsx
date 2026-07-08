import type { ComponentProps, ConfigComponentProps } from "@gonogo/core";
import {
  formatDistance,
  registerComponent,
  resolveTargetName,
  useDataStreamStatus,
  useDataValue,
} from "@gonogo/core";
import {
  buildCameraLabeler,
  useKerbcastCameras,
  useKerbcastStream,
} from "@gonogo/kerbcast";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Panel,
  PanelTitle,
  Select,
  StreamStatusBadge,
  Switch,
  useModalSaveBar,
} from "@gonogo/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";

/**
 * `{x,y,z}` — the wire shape of every `vessel.target`/`vessel.dock` Vec3
 * field (`mod/Sitrep.Contract/Vec3.cs`), as opposed to the tuple arrays
 * Telemachus used elsewhere (e.g. `AvailableVesselEntry.position`).
 */
interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function vecMagnitude(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

/**
 * Signed range-rate along the line of sight — d|relativePosition|/dt =
 * dot(relativePosition, relativeVelocity) / |relativePosition|. Matches the
 * legacy `tar.o.relativeVelocity` sign convention (positive = opening,
 * negative = closing): if the position vector points from us to the target
 * and the target is receding, the dot product is positive. `undefined` when
 * the position is exactly zero (can't form a unit vector) — never divides
 * by zero.
 */
function radialSpeed(position: Vec3, velocity: Vec3): number | undefined {
  const distance = vecMagnitude(position);
  if (distance === 0) return undefined;
  const dot =
    position.x * velocity.x + position.y * velocity.y + position.z * velocity.z;
  return dot / distance;
}

/**
 * Derives docking alignment angles (degrees off boresight, matching the
 * legacy `dock.ax`/`dock.ay` convention the reticle math below already
 * expects) from `vessel.dock.relativePosition` — a genuinely NEW client-side
 * derivation (M3 vessel-gap batch), not a reproduction of a legacy
 * Telemachus formula (the fork never published the raw vector these were
 * computed from). Assumes the docking-port-local frame's `z` is the
 * approach/boresight axis and `x`/`y` are the lateral offsets, mirroring
 * `KspVesselActuator`'s use of the SAME axis convention for `x`/`y` (used
 * verbatim below as the drop-in replacement for `dock.x`/`dock.y`). No `az`
 * (roll) equivalent exists on the wire — `vessel.dock` carries no roll
 * data at all, so that readout stays legacy-only.
 */
function deriveDockAngles(position: Vec3): { ax: number; ay: number } {
  const ax = (Math.atan2(position.x, Math.abs(position.z)) * 180) / Math.PI;
  const ay = (Math.atan2(position.y, Math.abs(position.z)) * 180) / Math.PI;
  return { ax, ay };
}

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
   * kerbcast camera flightId used for the video backdrop. Unset → first
   * available. Meaningful only when `hudMode === "hud-with-camera"`.
   */
  cameraFlightId?: number | null;
}

// Distances are in metres. Hysteresis prevents strobing at the thresholds.
const HUD_ENTER_M = 100;
const HUD_EXIT_M = 150;
const APPROACH_ENTER_M = 5_000;
const APPROACH_EXIT_M = 5_500;

type ViewMode = "tracking" | "approach" | "docking-hud";

function DistanceToTargetComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<DistanceToTargetConfig>>) {
  const autoSwitch = config?.autoSwitch !== false;
  const hudMode: DockingHudMode = config?.hudMode ?? "hud-with-camera";

  const legacyTarDistance = useDataValue("data", "tar.distance");
  const tarName = resolveTargetName(useDataValue("data", "tar.name"));
  const tarType = useDataValue("data", "tar.type");
  const legacyRelVel = useDataValue("data", "tar.o.relativeVelocity");
  const closestApproachUT = useDataValue("data", "o.closestTgtApprUT");
  const universalTime = useDataValue("data", "t.universalTime");
  const legacyDockAx = useDataValue("data", "dock.ax");
  const legacyDockAy = useDataValue("data", "dock.ay");
  const dockAz = useDataValue("data", "dock.az");
  const legacyDockX = useDataValue("data", "dock.x");
  const legacyDockY = useDataValue("data", "dock.y");

  // M3 vessel-gap batch: the NEW `vessel.target`/`vessel.dock` Vec3 reads.
  // `tar.distance`/`tar.o.relativeVelocity`/`dock.x`/`dock.y`/`dock.ax`/
  // `dock.ay` themselves stay legacy-only (map-topic.ts's
  // TELEMACHUS_KNOWN_GAPS — different shape); these coexist and, when
  // carried, win via the `??` merges below — the same MIXED-source pattern
  // CurrentOrbit's M3 batch-2 migration established.
  const tarRelPos = useDataValue<Vec3>("data", "tar.relativePosition");
  const tarRelVelVec = useDataValue<Vec3>("data", "tar.relativeVelocityVec");
  // vessel.dock is null unless the target is a docking port with a free
  // port on the active vessel — undefined here legitimately means "not a
  // docking scenario right now", not "still loading".
  const dockRelPos = useDataValue<Vec3>("data", "dock.relativePosition");
  const dockRelVelVec = useDataValue<Vec3>("data", "dock.relativeVelocityVec");
  const dockDistanceStream = useDataValue<number>(
    "data",
    "dock.distanceScalar",
  );
  const dockForwardDot = useDataValue<number>("data", "dock.forwardDot");
  const streamStatus = useDataStreamStatus("data", "tar.relativePosition");

  const derivedTarDistance = tarRelPos ? vecMagnitude(tarRelPos) : undefined;
  const tarDistance = derivedTarDistance ?? legacyTarDistance;
  const derivedRelVel =
    tarRelPos && tarRelVelVec
      ? radialSpeed(tarRelPos, tarRelVelVec)
      : undefined;
  const relVel = derivedRelVel ?? legacyRelVel;
  const derivedDockAngles = dockRelPos
    ? deriveDockAngles(dockRelPos)
    : undefined;
  const dockAx = derivedDockAngles?.ax ?? legacyDockAx;
  const dockAy = derivedDockAngles?.ay ?? legacyDockAy;
  const dockX = dockRelPos?.x ?? legacyDockX;
  const dockY = dockRelPos?.y ?? legacyDockY;
  const derivedDockRelVel =
    dockRelPos && dockRelVelVec
      ? radialSpeed(dockRelPos, dockRelVelVec)
      : undefined;
  // Docking HUD's Δv row prefers the port-to-port closing rate (more
  // accurate at close range) over the general vessel-to-vessel figure.
  const dockingRelVel = derivedDockRelVel ?? relVel;
  const dockingDistance = dockDistanceStream ?? tarDistance;

  // Mode hysteresis — sticky so we don't strobe near a threshold, and the
  // upgrade direction is asymmetric (smaller window to enter than to exit).
  const [mode, setMode] = useState<ViewMode>("tracking");

  const dockable =
    tarType !== undefined &&
    tarType !== "" &&
    tarType !== "CelestialBody" &&
    tarName !== undefined;

  useEffect(() => {
    if (!autoSwitch || !dockable || tarDistance === undefined) {
      if (mode !== "tracking") setMode("tracking");
      return;
    }
    if (mode === "tracking") {
      if (tarDistance <= HUD_ENTER_M) setMode("docking-hud");
      else if (tarDistance < APPROACH_ENTER_M) setMode("approach");
    } else if (mode === "approach") {
      if (tarDistance <= HUD_ENTER_M) setMode("docking-hud");
      else if (tarDistance > APPROACH_EXIT_M) setMode("tracking");
    } else if (mode === "docking-hud") {
      if (tarDistance > HUD_EXIT_M) setMode("approach");
    }
  }, [autoSwitch, dockable, tarDistance, mode]);

  if (tarName === undefined) {
    return (
      <Panel>
        <TitleRow>
          <PanelTitle>TARGET</PanelTitle>
          <StreamStatusBadge status={streamStatus} />
        </TitleRow>
        <NoTarget>No target set in KSP</NoTarget>
      </Panel>
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
        forwardDot={dockForwardDot}
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
        cols={cols}
        rows={rows}
      />
    );
  }

  // Tracking mode — selectively render auxiliary readouts as height shrinks.
  const showSubReadout =
    rows >= 5 && relVel !== undefined && Number.isFinite(relVel);
  const showTargetName = rows >= 4 || cols >= 5;

  return (
    <Panel>
      <TitleRow>
        <PanelTitle>TARGET</PanelTitle>
        <StreamStatusBadge status={streamStatus} />
      </TitleRow>
      <TrackingBody>
        {showTargetName && <TargetName>{tarName}</TargetName>}
        {tarDistance === undefined ? (
          <Dash>—</Dash>
        ) : (
          <Distance>{formatDistance(tarDistance)}</Distance>
        )}
        {showSubReadout && (
          <SubReadout>Δv {(relVel as number).toFixed(2)} m/s</SubReadout>
        )}
      </TrackingBody>
    </Panel>
  );
}

// ── Approach HUD ──────────────────────────────────────────────────────────────

interface ApproachHudProps {
  name: string;
  distance: number | undefined;
  relVel: number | undefined;
  closestApproachUT: number | null;
  universalTime: number | null;
  cols: number;
  rows: number;
}

/**
 * Approach mode: between the long-range tracking readout and the docking
 * HUD. Vessels in the 100 m – 5 km band are too close to be a "tracking"
 * problem and too far to align in the reticle. The relevant numbers are
 * closing rate + time to closest approach.
 *
 * `relVel` reads as positive when the gap is opening, negative when
 * closing — keep that convention so it matches `tar.o.relativeVelocity`'s
 * sign in the rest of the codebase.
 */
function ApproachHud({
  name,
  distance,
  relVel,
  closestApproachUT,
  universalTime,
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
    universalTime !== null &&
    Number.isFinite(closestApproachUT) &&
    Number.isFinite(universalTime)
      ? closestApproachUT - universalTime
      : null;

  // Tiniest reachable size (minSize h=4): the stacked label/value grid is
  // six lines tall and overflows the box — the closing-rate value and TCA
  // get clipped off the bottom edge. Mirror the tracking-tiny layout (the
  // distance is the headline, since it's the widget's name) and fold
  // closing rate into a one-line subreadout. TCA is the most derived value
  // and is the cut space forces here.
  if (rows < 5) {
    return (
      <Panel>
        <PanelTitle>APPROACH</PanelTitle>
        <TrackingBody>
          <TargetName>{name}</TargetName>
          {distance === undefined ? (
            <Dash>—</Dash>
          ) : (
            <Distance>{formatDistance(distance)}</Distance>
          )}
          {closingMagnitude !== null && (
            <SubReadout>
              {closing ? "−" : "+"}
              {closingMagnitude.toFixed(1)} m/s
            </SubReadout>
          )}
        </TrackingBody>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelTitle>APPROACH</PanelTitle>
      <TargetName>{name}</TargetName>
      <ApproachGrid $stack={stack}>
        <ApproachLabel>Distance</ApproachLabel>
        <ApproachValue>
          {distance === undefined ? "—" : formatDistance(distance)}
        </ApproachValue>

        <ApproachLabel>Closing rate</ApproachLabel>
        <ApproachValue $tone={closing ? "ok" : "warn"}>
          {closingMagnitude === null
            ? "—"
            : `${closing ? "−" : "+"}${closingMagnitude.toFixed(1)} m/s`}
        </ApproachValue>

        <ApproachLabel>TCA</ApproachLabel>
        <ApproachValue>
          {tcaSeconds === null ? "—" : formatTca(tcaSeconds)}
        </ApproachValue>
      </ApproachGrid>
    </Panel>
  );
}

function formatTca(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const sign = seconds < 0 ? "T+" : "T−";
  const abs = Math.abs(seconds);
  const m = Math.floor(abs / 60);
  const s = Math.floor(abs % 60);
  return `${sign}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
   * `vessel.dock.forwardDot` — cosine of the angle between the two ports'
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

/**
 * Compact docking HUD — a fixed crosshair with the target reticle drifting
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
  // row layout — reticle on the left, readout panel beside it on the right
  // — instead of dropping the reticle entirely.
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
  // detail rows here — Δv alone is the headline closing/opening cue and
  // the precision-instruments view is reserved for compact and above.
  const showAlignmentDetail = cols >= 4;

  // Angular mapping to HUD coords. Clamp beyond ±8° so the reticle stays
  // inside the visible box — past that the pilot isn't docking, they're
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
  // alignment signal when available — 0.9998 ~= within ~1° of dead-on,
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

  return (
    <HudPanel
      role="region"
      aria-label={`Docking HUD for ${name}`}
      $row={wideShort}
    >
      {showCamera && showViewport && <HudCamera flightId={cameraFlightId} />}
      {showViewport && (
        <Viewport>
          {/* Fixed centre crosshair */}
          <Crosshair />
          {/* Reticle driven by alignment angles */}
          <Reticle
            $aligned={aligned}
            style={{
              left: `${50 + dx * 40}%`,
              top: `${50 + dy * 40}%`,
            }}
          />
          {/* Axis ticks — give the pilot a sense of scale */}
          <HorizTick style={{ left: "10%" }} />
          <HorizTick style={{ left: "30%" }} />
          <HorizTick style={{ left: "70%" }} />
          <HorizTick style={{ left: "90%" }} />
          <VertTick style={{ top: "10%" }} />
          <VertTick style={{ top: "30%" }} />
          <VertTick style={{ top: "70%" }} />
          <VertTick style={{ top: "90%" }} />
        </Viewport>
      )}

      <HudOverlay $side={wideShort}>
        <HudHeader>
          <HudName>{name}</HudName>
          <HudRange>
            {distance === undefined ? "—" : formatDistance(distance)}
          </HudRange>
        </HudHeader>
        <HudGrid $stack={stackReadouts}>
          <HudLabel>Δv</HudLabel>
          <HudValue $tone={closing ? "ok" : "warn"}>
            {relVel === undefined || !Number.isFinite(relVel)
              ? "—"
              : `${relVel.toFixed(2)} m/s`}
          </HudValue>

          {showAlignmentDetail && (
            <>
              <HudLabel>X/Y</HudLabel>
              <HudValue>
                {x === undefined ? "—" : `${x.toFixed(2)} m`} /{" "}
                {y === undefined ? "—" : `${y.toFixed(2)} m`}
              </HudValue>

              <HudLabel>α/β/γ</HudLabel>
              <HudValue>
                {ax === undefined ? "—" : `${ax.toFixed(1)}°`} ·{" "}
                {ay === undefined ? "—" : `${ay.toFixed(1)}°`} ·{" "}
                {az === undefined ? "—" : `${az.toFixed(1)}°`}
              </HudValue>
            </>
          )}
        </HudGrid>
      </HudOverlay>
    </HudPanel>
  );
}

function HudCamera({ flightId }: { flightId: number | null | undefined }) {
  const cameras = useKerbcastCameras();
  // Pick the configured camera if it's still available, otherwise first.
  const resolved =
    flightId != null && cameras.some((c) => c.flightId === flightId)
      ? flightId
      : (cameras[0]?.flightId ?? null);
  const stream = useKerbcastStream(resolved);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) {
      // play() can reject when srcObject is reassigned mid-flight — benign.
      void v.play().catch(() => {});
    }
  }, [stream]);

  if (!stream) return null;
  return <HudVideo ref={videoRef} autoPlay muted playsInline />;
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
  const [cameraFlightId, setCameraFlightId] = useState<number | null>(
    config?.cameraFlightId ?? null,
  );
  const cameras = useKerbcastCameras();
  // Same docking-port name disambiguation as the CameraFeed picker.
  const cameraLabel = useMemo(() => buildCameraLabeler(cameras), [cameras]);

  const candidate = useMemo<DistanceToTargetConfig>(
    () => ({
      autoSwitch,
      hudMode,
      cameraFlightId: cameraFlightId ?? undefined,
    }),
    [autoSwitch, hudMode, cameraFlightId],
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
      </Field>
      {hudMode === "hud-with-camera" && (
        <Field>
          <FieldLabel htmlFor="dtt-camera">Camera stream</FieldLabel>
          <Select
            id="dtt-camera"
            value={cameraFlightId == null ? "" : String(cameraFlightId)}
            onChange={(e) =>
              setCameraFlightId(
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
          >
            <option value="">(first available)</option>
            {cameras.map((c) => (
              <option key={c.flightId} value={c.flightId}>
                {cameraLabel(c)} ({c.vesselName})
              </option>
            ))}
          </Select>
          <FieldHint>
            Point at a HullCam docking camera for a live view behind the
            reticle.
          </FieldHint>
        </Field>
      )}
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
  dataRequirements: [
    "tar.distance",
    "tar.name",
    "tar.type",
    "tar.o.relativeVelocity",
    "o.closestTgtApprUT",
    "t.universalTime",
    "dock.ax",
    "dock.ay",
    "dock.az",
    "dock.x",
    "dock.y",
    "tar.relativePosition",
    "tar.relativeVelocityVec",
    "dock.relativePosition",
    "dock.relativeVelocityVec",
    "dock.distanceScalar",
    "dock.forwardDot",
  ],
  defaultConfig: { autoSwitch: true, hudMode: "hud-with-camera" },
  pushable: true,
  requires: ["flight"],
});

export { DistanceToTargetComponent };

// ── Styles — compact mode ─────────────────────────────────────────────────────

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
`;

const TrackingBody = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  min-height: 0;
`;

const TargetName = styled.div`
  font-size: 13px;
  color: var(--color-text-primary);
  letter-spacing: 0.05em;
`;

const Distance = styled.div`
  font-size: 22px;
  font-weight: 600;
  color: var(--color-accent-fg);
  letter-spacing: 0.02em;
  line-height: 1.1;
`;

const Dash = styled.div`
  font-size: 22px;
  font-weight: 600;
  color: var(--color-border-strong);
`;

const NoTarget = styled.div`
  font-size: 11px;
  color: var(--color-text-faint);
`;

const SubReadout = styled.div`
  margin-top: 4px;
  font-size: 11px;
  color: var(--color-text-muted);
  letter-spacing: 0.04em;
`;

// ── Styles — approach mode ────────────────────────────────────────────────────

const ApproachGrid = styled.div<{ $stack: boolean }>`
  display: grid;
  /* Wide widgets get a paired label/value row; narrow widgets stack so
     the value claims the full inner width — fixes the auto/1fr collapse
     where "Closing rate" wrapped to two lines and "T−02:05" clipped. */
  grid-template-columns: ${({ $stack }) => ($stack ? "1fr" : "auto 1fr")};
  column-gap: 12px;
  row-gap: ${({ $stack }) => ($stack ? "0" : "4px")};
  margin-top: 6px;
`;

const ApproachLabel = styled.span`
  font-size: var(--font-size-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  align-self: baseline;
  white-space: nowrap;
`;

const ApproachValue = styled.span<{ $tone?: "ok" | "warn" }>`
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: ${({ $tone }) =>
    $tone === "ok"
      ? "var(--color-accent-fg)"
      : $tone === "warn"
        ? "var(--color-status-warning-bg)"
        : "var(--color-text-primary)"};
`;

// ── Styles — HUD mode ─────────────────────────────────────────────────────────

const HudPanel = styled.div<{ $row?: boolean }>`
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: ${({ $row }) => ($row ? "row" : "column")};
  background: var(--color-surface-app);
  border-radius: 2px;
  overflow: hidden;
`;

const HudVideo = styled.video`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.55;
`;

const Viewport = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
  /* Subtle green tint over the video to sell the instrument feel. */
  background: radial-gradient(
    circle at center,
    rgba(0, 255, 136, 0.08) 0%,
    rgba(0, 0, 0, 0.3) 70%
  );
`;

const Crosshair = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  &::before,
  &::after {
    content: "";
    position: absolute;
    background: rgba(0, 255, 136, 0.75);
  }
  &::before {
    left: 0;
    right: 0;
    top: 50%;
    height: 1px;
    transform: translateY(-0.5px);
  }
  &::after {
    top: 0;
    bottom: 0;
    left: 50%;
    width: 1px;
    transform: translateX(-0.5px);
  }
`;

const Reticle = styled.div<{ $aligned: boolean }>`
  position: absolute;
  width: 22px;
  height: 22px;
  border: 2px solid
    ${({ $aligned }) => ($aligned ? "var(--color-accent-fg)" : "var(--color-status-warning-bg)")};
  border-radius: 50%;
  transform: translate(-50%, -50%);
  transition: left 80ms linear, top 80ms linear, border-color 150ms linear;
  /* Ring only — centre stays transparent so the crosshair stays visible. */
  box-shadow: 0 0 6px
    ${({ $aligned }) =>
      $aligned ? "rgba(0,255,136,0.6)" : "rgba(255,152,0,0.5)"};
`;

const tickBase = `
  position: absolute;
  background: rgba(0, 255, 136, 0.35);
  pointer-events: none;
`;

const HorizTick = styled.div`
  ${tickBase}
  top: 50%;
  width: 1px;
  height: 8px;
  transform: translateY(-4px);
`;

const VertTick = styled.div`
  ${tickBase}
  left: 50%;
  height: 1px;
  width: 8px;
  transform: translateX(-4px);
`;

const HudOverlay = styled.div<{ $side?: boolean }>`
  padding: 6px 10px 8px;
  background: rgba(0, 0, 0, 0.55);
  /* Wide-short row layout docks the overlay to the side: fixed-width
     right column with a left divider instead of the full-width bottom
     bar. Centre it vertically so it reads as a paired panel. */
  ${({ $side }) =>
    $side
      ? `
        flex: 0 0 240px;
        align-self: stretch;
        display: flex;
        flex-direction: column;
        justify-content: center;
        border-left: 1px solid rgba(0, 255, 136, 0.2);
      `
      : `
        border-top: 1px solid rgba(0, 255, 136, 0.2);
      `}
`;

const HudHeader = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
`;

const HudName = styled.span`
  font-size: 12px;
  color: var(--color-status-go-fg);
  letter-spacing: 0.04em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const HudRange = styled.span`
  font-size: 16px;
  font-weight: 700;
  color: var(--color-accent-fg);
  white-space: nowrap;
`;

const HudGrid = styled.div<{ $stack: boolean }>`
  display: grid;
  /* Narrow widgets stack so X/Y and α/β/γ values aren't squeezed into a
     1fr column that can't hold them on one line. */
  grid-template-columns: ${({ $stack }) => ($stack ? "1fr" : "auto 1fr")};
  gap: 1px 8px;
  margin-top: 4px;
`;

const HudLabel = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-status-go-fg);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  white-space: nowrap;
`;

const HudValue = styled.span<{ $tone?: "ok" | "warn" }>`
  font-size: 11px;
  white-space: nowrap;
  color: ${({ $tone }) =>
    $tone === "warn"
      ? "var(--color-status-warning-bg)"
      : $tone === "ok"
        ? "var(--color-accent-fg)"
        : "var(--color-status-go-fg)"};
`;
