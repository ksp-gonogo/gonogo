import type { ComponentProps, ConfigComponentProps } from "@gonogo/core";
import {
  formatDistance,
  registerComponent,
  useDataValue,
  useStream,
  useStreamList,
} from "@gonogo/core";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Panel,
  PanelTitle,
  PrimaryButton,
  Select,
  Switch,
} from "@gonogo/ui";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";

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
   * OCISLY stream id used for the video backdrop. Empty → first available.
   * Meaningful only when `hudMode === "hud-with-camera"`.
   */
  cameraId?: string;
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

  const tarDistance = useDataValue("data", "tar.distance");
  const tarName = useDataValue("data", "tar.name");
  const tarType = useDataValue("data", "tar.type");
  const relVel = useDataValue("data", "tar.o.relativeVelocity");
  const closestApproachUT = useDataValue("data", "o.closestTgtApprUT");
  const universalTime = useDataValue("data", "t.universalTime");
  const dockAx = useDataValue("data", "dock.ax");
  const dockAy = useDataValue("data", "dock.ay");
  const dockAz = useDataValue("data", "dock.az");
  const dockX = useDataValue("data", "dock.x");
  const dockY = useDataValue("data", "dock.y");

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
        <PanelTitle>TARGET</PanelTitle>
        <NoTarget>No target set in KSP</NoTarget>
      </Panel>
    );
  }

  if (mode === "docking-hud") {
    return (
      <DockingHud
        name={tarName}
        distance={tarDistance}
        relVel={relVel}
        ax={dockAx}
        ay={dockAy}
        az={dockAz}
        x={dockX}
        y={dockY}
        showCamera={hudMode === "hud-with-camera"}
        cameraId={config?.cameraId}
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
      />
    );
  }

  // Tracking mode — selectively render auxiliary readouts as height shrinks.
  const rows = h ?? 5;
  const cols = w ?? 6;
  const showSubReadout =
    rows >= 5 && relVel !== undefined && Number.isFinite(relVel);
  const showTargetName = rows >= 4 || cols >= 5;

  return (
    <Panel>
      <PanelTitle>TARGET</PanelTitle>
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
}: ApproachHudProps) {
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

  return (
    <Panel>
      <PanelTitle>APPROACH</PanelTitle>
      <TargetName>{name}</TargetName>
      <ApproachGrid>
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
  showCamera: boolean;
  cameraId: string | undefined;
}

/**
 * Compact docking HUD — a fixed crosshair with the target reticle drifting
 * in proportion to the docking alignment angles. `dock.ax` / `dock.ay` are in
 * degrees; we map them into the visible box at ~8° = edge, so small angles
 * are visible but extreme misalignment clamps instead of sailing off-screen.
 */
function DockingHud(props: DockingHudProps) {
  const { name, distance, relVel, ax, ay, az, x, y, showCamera, cameraId } =
    props;

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

  const aligned =
    ax !== undefined &&
    ay !== undefined &&
    Math.abs(ax) < 1 &&
    Math.abs(ay) < 1;

  // Closing if relVel is negative (standard KSP convention: positive = opening).
  const closing = relVel !== undefined && relVel < 0;

  return (
    <HudPanel role="region" aria-label={`Docking HUD for ${name}`}>
      {showCamera && <HudCamera cameraId={cameraId} />}
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

      <HudOverlay>
        <HudHeader>
          <HudName>{name}</HudName>
          <HudRange>
            {distance === undefined ? "—" : formatDistance(distance)}
          </HudRange>
        </HudHeader>
        <HudGrid>
          <HudLabel>Δv</HudLabel>
          <HudValue $tone={closing ? "ok" : "warn"}>
            {relVel === undefined || !Number.isFinite(relVel)
              ? "—"
              : `${relVel.toFixed(2)} m/s`}
          </HudValue>

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
        </HudGrid>
      </HudOverlay>
    </HudPanel>
  );
}

function HudCamera({ cameraId }: { cameraId: string | undefined }) {
  const streams = useStreamList("ocisly");
  // Pick the configured id if it's still available, otherwise first.
  const resolvedId =
    cameraId && streams.some((s) => s.id === cameraId)
      ? cameraId
      : (streams[0]?.id ?? null);
  const { stream } = useStream("ocisly", resolvedId);
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
  const [cameraId, setCameraId] = useState(config?.cameraId ?? "");
  const streams = useStreamList("ocisly");

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
            value={cameraId}
            onChange={(e) => setCameraId(e.target.value)}
          >
            <option value="">(first available)</option>
            {streams.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name ?? s.id}
              </option>
            ))}
          </Select>
          <FieldHint>
            Point at a HullCam docking camera for a live view behind the
            reticle.
          </FieldHint>
        </Field>
      )}
      <PrimaryButton
        onClick={() =>
          onSave({
            autoSwitch,
            hudMode,
            cameraId: cameraId || undefined,
          })
        }
      >
        Save
      </PrimaryButton>
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
  ],
  defaultConfig: { autoSwitch: true, hudMode: "hud-with-camera" },
  pushable: true,
});

export { DistanceToTargetComponent };

// ── Styles — compact mode ─────────────────────────────────────────────────────

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

const ApproachGrid = styled.div`
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 12px;
  row-gap: 4px;
  margin-top: 6px;
`;

const ApproachLabel = styled.span`
  font-size: var(--font-size-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  align-self: baseline;
`;

const ApproachValue = styled.span<{ $tone?: "ok" | "warn" }>`
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: ${({ $tone }) =>
    $tone === "ok"
      ? "var(--color-accent-fg)"
      : $tone === "warn"
        ? "var(--color-status-warning-bg)"
        : "var(--color-text-primary)"};
`;

// ── Styles — HUD mode ─────────────────────────────────────────────────────────

const HudPanel = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
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

const HudOverlay = styled.div`
  padding: 6px 10px 8px;
  background: rgba(0, 0, 0, 0.55);
  border-top: 1px solid rgba(0, 255, 136, 0.2);
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
`;

const HudGrid = styled.div`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1px 8px;
  margin-top: 4px;
`;

const HudLabel = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-status-go-fg);
  letter-spacing: 0.12em;
  text-transform: uppercase;
`;

const HudValue = styled.span<{ $tone?: "ok" | "warn" }>`
  font-size: 11px;
  color: ${({ $tone }) =>
    $tone === "warn"
      ? "var(--color-status-warning-bg)"
      : $tone === "ok"
        ? "var(--color-accent-fg)"
        : "var(--color-status-go-fg)"};
`;
