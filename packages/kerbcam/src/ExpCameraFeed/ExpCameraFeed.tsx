import type { ActionDefinition, ComponentProps } from "@gonogo/core";
import {
  useActionInput,
  useDataSources,
  useDataValue,
  useExecuteAction,
} from "@gonogo/core";
import {
  IconButton,
  Panel,
  PanelSubtitle,
  PanelTitle,
  Select,
  StatusIndicator,
  type StatusTone,
} from "@gonogo/ui";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import styled, { css } from "styled-components";
import { useKerbcamCameras } from "../hooks/useKerbcamCameras";
import { useKerbcamStream } from "../hooks/useKerbcamStream";
import { getCameraLifecycle } from "../lifecycle";

// ── Pan directional-pad tuning ──────────────────────────────────────────────
// The rate loop ticks every PAN_TICK_MS; at full ball deflection (or an arrow
// hold) the angle advances at *_RATE_DEG_S degrees/sec. A keyboard activation
// nudges by PAN_NUDGE_DEG. PAN_BALL_RADIUS is the ball's pixel deflection bound.
const PAN_TICK_MS = 50;
// Rate at full ball deflection / arrow hold. The ball is analog, so partial
// deflection pans slower — these are the controllable ceiling for framing, not
// a fast slew.
const PAN_YAW_RATE_DEG_S = 15;
const PAN_PITCH_RATE_DEG_S = 12;
const PAN_ARROW_RATE = 0.5;
const PAN_NUDGE_DEG = 5;
const PAN_BALL_RADIUS = 30;

const clampPan = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

export interface ExpCameraFeedConfig extends Record<string, unknown> {
  /**
   * KSP `Part.flightID` of the camera to stream. `null` (the
   * default) auto-picks the first available — handy for "drop the
   * widget on a dashboard and it just works", and the natural state
   * before the operator has explicitly picked one. Once the operator
   * selects a camera (via the in-widget picker or a Next/Previous
   * input) the chosen flightId is persisted here.
   */
  flightId: number | null;
}

/** Component actions exposed to the serial-input platform. */
export const expCameraFeedActions = [
  {
    id: "nextCamera",
    label: "Next camera",
    accepts: ["button"],
    description:
      "Switch to the next available camera, persisting the choice to the widget config (wraps round at the end of the list).",
  },
  {
    id: "prevCamera",
    label: "Previous camera",
    accepts: ["button"],
    description: "Switch to the previous available camera (wraps round).",
  },
] as const satisfies readonly ActionDefinition[];

export type ExpCameraFeedActions = typeof expCameraFeedActions;

/** Round n to the nearest even integer, minimum 2 (H.264 chroma requirement). */
function toEvenPx(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

function statusTone(status: string | undefined): StatusTone {
  switch (status) {
    case "connected":
      return "go";
    case "reconnecting":
      return "warn";
    case "error":
    case "disconnected":
      return "nogo";
    default:
      return "neutral";
  }
}

function statusLabel(status: string | undefined): string {
  switch (status) {
    case "connected":
      return "Sidecar connected";
    case "reconnecting":
      return "Connecting to sidecar…";
    case "error":
      return "Sidecar error";
    case "disconnected":
      return "Sidecar disconnected";
    default:
      return "Sidecar status unknown";
  }
}

export function ExpCameraFeed({
  config,
  onConfigChange,
}: Readonly<ComponentProps<ExpCameraFeedConfig>>) {
  const cameras = useKerbcamCameras();
  const requested = config?.flightId ?? null;

  // --------------------------------------------------------------------------
  // Selection model — pure derivation, no render-time refs.
  //
  // `config.flightId` is the single source of truth. `null` means
  // "auto": fall back to the first available camera. If the operator
  // explicitly picked a camera that has since disappeared (vessel
  // change, part destroyed), we also fall back to the first available
  // so the widget never wedges on a dead id.
  // --------------------------------------------------------------------------
  const firstFlightId = cameras[0]?.flightId ?? null;
  const requestedStillPresent =
    requested !== null && cameras.some((c) => c.flightId === requested);
  const flightId = requestedStillPresent ? requested : firstFlightId;

  const camera =
    flightId !== null
      ? (cameras.find((c) => c.flightId === flightId) ?? null)
      : null;

  // --------------------------------------------------------------------------
  // Connection status — surfaced from the kerbcam DataSource itself, so the
  // operator can tell "no cameras because the sidecar is down" apart from
  // "connected but the vessel has no Hullcams".
  // --------------------------------------------------------------------------
  const dataSources = useDataSources();
  const kerbcamStatus = dataSources.find((s) => s.id === "kerbcam")?.status;

  const stream = useKerbcamStream(flightId);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const lifecycle = camera ? getCameraLifecycle(camera) : "active";
  const isDestroyed = lifecycle === "destroyed";

  const executeKerbcam = useExecuteAction("kerbcam");

  // --------------------------------------------------------------------------
  // Camera selection — picker + Next/Prev. All paths persist through
  // onConfigChange so the choice survives a remount, mirroring CameraFeed.
  // --------------------------------------------------------------------------
  const selectCamera = useCallback(
    (nextFlightId: number | null) => {
      onConfigChange?.({ ...(config ?? {}), flightId: nextFlightId });
    },
    [config, onConfigChange],
  );

  const currentIndex = useMemo(
    () =>
      flightId !== null
        ? cameras.findIndex((c) => c.flightId === flightId)
        : -1,
    [cameras, flightId],
  );

  const stepCamera = useCallback(
    (delta: number) => {
      if (cameras.length === 0) return;
      const base = currentIndex >= 0 ? currentIndex : 0;
      const next = (base + delta + cameras.length) % cameras.length;
      selectCamera(cameras[next]?.flightId ?? null);
    },
    [cameras, currentIndex, selectCamera],
  );

  useActionInput<ExpCameraFeedActions>({
    nextCamera: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return;
      stepCamera(1);
    },
    prevCamera: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return;
      stepCamera(-1);
    },
  });

  // --------------------------------------------------------------------------
  // Feature: Render-size feedback (ResizeObserver, 500ms debounce)
  // --------------------------------------------------------------------------
  const wrapRef = useRef<HTMLDivElement>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (flightId === null) return;
    const el = wrapRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (resizeTimerRef.current !== null) clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(() => {
        const w = toEvenPx(width);
        const h = toEvenPx(height);
        void executeKerbcam(`kerbcam.set-render-size[${flightId},${w},${h}]`);
      }, 500);
    });

    observer.observe(el);

    return () => {
      observer.disconnect();
      if (resizeTimerRef.current !== null) clearTimeout(resizeTimerRef.current);
    };
  }, [flightId, executeKerbcam]);

  // --------------------------------------------------------------------------
  // Feature: CommNet signal degrade (500ms debounce)
  // --------------------------------------------------------------------------
  const signalStrength = useDataValue<number>("data", "comm.signalStrength");
  const commConnected = useDataValue<boolean>("data", "comm.connected");
  const degradeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (flightId === null) return;
    // If both values are undefined, CommNet data isn't available — skip
    if (signalStrength === undefined && commConnected === undefined) return;

    let level: number;
    if (commConnected === false) {
      level = 1.0;
    } else if (typeof signalStrength === "number") {
      level = Math.max(0, Math.min(1, 1 - signalStrength));
    } else {
      return;
    }

    if (degradeTimerRef.current !== null) clearTimeout(degradeTimerRef.current);
    degradeTimerRef.current = setTimeout(() => {
      void executeKerbcam(`kerbcam.set-degrade[${flightId},${level}]`);
    }, 500);

    return () => {
      if (degradeTimerRef.current !== null)
        clearTimeout(degradeTimerRef.current);
    };
  }, [flightId, signalStrength, commConnected, executeKerbcam]);

  // --------------------------------------------------------------------------
  // Feature: Zoom controls (FoV) — handler
  // --------------------------------------------------------------------------
  const onFovChange = useCallback(
    (newFov: number) => {
      if (flightId === null || !camera) return;
      const clamped = Math.max(camera.fovMin, Math.min(camera.fovMax, newFov));
      void executeKerbcam(`kerbcam.set-fov[${flightId},${clamped}]`);
    },
    [flightId, camera, executeKerbcam],
  );

  // --------------------------------------------------------------------------
  // Feature: Pan reticle — drag pad for yaw/pitch
  // --------------------------------------------------------------------------

  // Pitch is adjustable only when the camera reports a non-zero pitch range.
  const supportsPitch = !!camera && camera.panPitchMax - camera.panPitchMin > 0;

  // Optimistic local angle the rate loop advances; rateRef is the normalised
  // [-1, 1] velocity from the ball / arrows. panEnvRef is the loop's always-
  // fresh snapshot of bounds + flightId + execute, so the interval never reads
  // a stale closure.
  const localPanRef = useRef({ yaw: 0, pitch: 0 });
  const rateRef = useRef({ yaw: 0, pitch: 0 });
  const ballDragRef = useRef({ active: false, startX: 0, startY: 0 });
  const panIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [ballPos, setBallPos] = useState({ x: 0, y: 0 });
  const panEnvRef = useRef({
    flightId: null as number | null,
    yawMin: 0,
    yawMax: 0,
    pitchMin: 0,
    pitchMax: 0,
    execute: executeKerbcam,
  });
  useEffect(() => {
    panEnvRef.current = {
      flightId,
      yawMin: camera?.panYawMin ?? 0,
      yawMax: camera?.panYawMax ?? 0,
      pitchMin: camera?.panPitchMin ?? 0,
      pitchMax: camera?.panPitchMax ?? 0,
      execute: executeKerbcam,
    };
  }, [flightId, camera, executeKerbcam]);

  // Sync the optimistic angle from sidecar state while idle, so the next
  // interaction starts from the camera's true pan.
  useEffect(() => {
    if (
      !ballDragRef.current.active &&
      rateRef.current.yaw === 0 &&
      rateRef.current.pitch === 0 &&
      camera
    ) {
      localPanRef.current = { yaw: camera.panYaw, pitch: camera.panPitch };
    }
  }, [camera]);

  const stopPanLoop = useCallback(() => {
    if (panIntervalRef.current !== null) {
      clearInterval(panIntervalRef.current);
      panIntervalRef.current = null;
    }
  }, []);

  // The rate loop: while a velocity is set, advance the optimistic angle and
  // push the new absolute angle to the sidecar (the set-pan API is absolute,
  // so a joystick velocity becomes a stream of absolute updates). Clears itself
  // once the velocity returns to zero.
  const ensurePanLoop = useCallback(() => {
    if (panIntervalRef.current !== null) return;
    panIntervalRef.current = setInterval(() => {
      const env = panEnvRef.current;
      const rate = rateRef.current;
      if (rate.yaw === 0 && rate.pitch === 0) {
        stopPanLoop();
        return;
      }
      if (env.flightId === null) return;
      const dt = PAN_TICK_MS / 1000;
      const loc = localPanRef.current;
      loc.yaw = clampPan(
        loc.yaw + rate.yaw * PAN_YAW_RATE_DEG_S * dt,
        env.yawMin,
        env.yawMax,
      );
      loc.pitch = clampPan(
        loc.pitch + rate.pitch * PAN_PITCH_RATE_DEG_S * dt,
        env.pitchMin,
        env.pitchMax,
      );
      void env.execute(
        `kerbcam.set-pan[${env.flightId},${loc.yaw},${loc.pitch}]`,
      );
    }, PAN_TICK_MS);
  }, [stopPanLoop]);

  useEffect(() => stopPanLoop, [stopPanLoop]); // stop on unmount

  const showPan = camera?.supportsPan && !isDestroyed;

  // Hard stop if the control is hidden mid-hold (signal lost / pan support
  // dropped): the captured pointer's release never reaches us then, so without
  // this the interval would keep panning a dead camera.
  useEffect(() => {
    if (!showPan) {
      rateRef.current = { yaw: 0, pitch: 0 };
      ballDragRef.current.active = false;
      setBallPos({ x: 0, y: 0 });
      stopPanLoop();
    }
  }, [showPan, stopPanLoop]);

  // Arrows: press-and-hold for continuous pan; a keyboard activation (click
  // with detail === 0) does a single discrete nudge instead.
  const startArrow = useCallback(
    (yaw: number, pitch: number) => {
      rateRef.current = { yaw, pitch };
      ensurePanLoop();
    },
    [ensurePanLoop],
  );
  const releaseArrow = useCallback(() => {
    if (!ballDragRef.current.active) rateRef.current = { yaw: 0, pitch: 0 };
  }, []);
  const nudgePan = useCallback((yawSign: number, pitchSign: number) => {
    const env = panEnvRef.current;
    if (env.flightId === null) return;
    const loc = localPanRef.current;
    loc.yaw = clampPan(
      loc.yaw + yawSign * PAN_NUDGE_DEG,
      env.yawMin,
      env.yawMax,
    );
    loc.pitch = clampPan(
      loc.pitch + pitchSign * PAN_NUDGE_DEG,
      env.pitchMin,
      env.pitchMax,
    );
    void env.execute(
      `kerbcam.set-pan[${env.flightId},${loc.yaw},${loc.pitch}]`,
    );
  }, []);

  // Ball: drag = analog rate (deflection ∝ velocity); release springs to centre
  // and the loop idles. Vertical (pitch) is locked when pitch isn't supported.
  const handleBallDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (flightId === null) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      ballDragRef.current = {
        active: true,
        startX: e.clientX,
        startY: e.clientY,
      };
      ensurePanLoop();
    },
    [flightId, ensurePanLoop],
  );
  const handleBallMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = ballDragRef.current;
      if (!drag.active) return;
      const env = panEnvRef.current;
      const hasPitch = env.pitchMax - env.pitchMin > 0;
      let dx = e.clientX - drag.startX;
      let dy = hasPitch ? e.clientY - drag.startY : 0;
      const mag = Math.hypot(dx, dy);
      if (mag > PAN_BALL_RADIUS) {
        const k = PAN_BALL_RADIUS / mag;
        dx *= k;
        dy *= k;
      }
      setBallPos({ x: dx, y: dy });
      rateRef.current = {
        yaw: dx / PAN_BALL_RADIUS,
        pitch: -dy / PAN_BALL_RADIUS,
      };
    },
    [],
  );
  const handleBallUp = useCallback(() => {
    ballDragRef.current.active = false;
    rateRef.current = { yaw: 0, pitch: 0 };
    setBallPos({ x: 0, y: 0 });
  }, []);

  // --------------------------------------------------------------------------
  // Derived subtitle parts
  // --------------------------------------------------------------------------
  const bitrateLabel =
    camera && camera.encoderBitrateBps > 0
      ? ` · ${Math.round(camera.encoderBitrateBps / 1000)}kbps`
      : "";
  const adaptiveLabel =
    camera && camera.renderWidth < camera.operatorWidth ? " · adaptive" : "";

  const showZoom = camera?.supportsZoom && !isDestroyed;
  const hasCameras = cameras.length > 0;
  const canStep = cameras.length > 1;

  // Unique per widget instance so two ExpCameraFeeds on one dashboard don't
  // produce duplicate ids (which would break the label→select association).
  const selectId = useId();

  return (
    <Panel>
      <PanelTitle>{camera?.cameraName ?? "Camera Feed (exp)"}</PanelTitle>
      {camera ? (
        <PanelSubtitle>
          {camera.vesselName} · {camera.renderWidth}×{camera.renderHeight}
          {bitrateLabel}
          {adaptiveLabel}
        </PanelSubtitle>
      ) : (
        <PanelSubtitle>
          {kerbcamStatus === "connected"
            ? "no cameras on this vessel"
            : "waiting for sidecar handshake…"}
        </PanelSubtitle>
      )}

      <StatusIndicator
        tone={statusTone(kerbcamStatus)}
        live
        aria-label={statusLabel(kerbcamStatus)}
      >
        {statusLabel(kerbcamStatus)}
      </StatusIndicator>

      {hasCameras && (
        <SelectionBar>
          <CameraPickerLabel htmlFor={selectId}>Camera</CameraPickerLabel>
          <CameraSelect
            id={selectId}
            value={flightId ?? ""}
            onChange={(e) =>
              selectCamera(
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
          >
            {cameras.map((c) => (
              <option key={c.flightId} value={c.flightId}>
                {c.cameraName} ({c.vesselName})
              </option>
            ))}
          </CameraSelect>
          <IconButton
            type="button"
            aria-label="Previous camera"
            disabled={!canStep}
            onClick={() => stepCamera(-1)}
          >
            ‹
          </IconButton>
          <IconButton
            type="button"
            aria-label="Next camera"
            disabled={!canStep}
            onClick={() => stepCamera(1)}
          >
            ›
          </IconButton>
        </SelectionBar>
      )}

      <VideoWrap ref={wrapRef}>
        {flightId === null ? (
          <Empty>
            {kerbcamStatus === "connected"
              ? "no cameras detected — start a vessel with Hullcams installed"
              : "no cameras detected — is the kerbcam sidecar running?"}
          </Empty>
        ) : (
          <>
            <StyledVideo
              ref={videoRef}
              autoPlay
              playsInline
              muted
              controls={false}
              $destroyed={isDestroyed}
            />
            {isDestroyed && (
              <SignalLostOverlay role="status" aria-label="Signal lost">
                <SignalLostText>SIGNAL LOST</SignalLostText>
              </SignalLostOverlay>
            )}
            {showZoom && (
              <ZoomControlsWrap>
                <ZoomButton
                  type="button"
                  aria-label="Zoom in"
                  onClick={() => onFovChange(camera.fov - 5)}
                >
                  +
                </ZoomButton>
                <ZoomButton
                  type="button"
                  aria-label="Zoom out"
                  onClick={() => onFovChange(camera.fov + 5)}
                >
                  −
                </ZoomButton>
              </ZoomControlsWrap>
            )}
            {showPan && (
              <PanControl role="group" aria-label="Pan camera">
                <PanRing aria-hidden="true" />
                <PanArrow
                  type="button"
                  $dir="up"
                  aria-label="Pan up"
                  disabled={!supportsPitch}
                  onPointerDown={() => startArrow(0, PAN_ARROW_RATE)}
                  onPointerUp={releaseArrow}
                  onPointerLeave={releaseArrow}
                  onClick={(e) => {
                    if (e.detail === 0) nudgePan(0, 1);
                  }}
                >
                  ▲
                </PanArrow>
                <PanArrow
                  type="button"
                  $dir="down"
                  aria-label="Pan down"
                  disabled={!supportsPitch}
                  onPointerDown={() => startArrow(0, -PAN_ARROW_RATE)}
                  onPointerUp={releaseArrow}
                  onPointerLeave={releaseArrow}
                  onClick={(e) => {
                    if (e.detail === 0) nudgePan(0, -1);
                  }}
                >
                  ▼
                </PanArrow>
                <PanArrow
                  type="button"
                  $dir="left"
                  aria-label="Pan left"
                  onPointerDown={() => startArrow(-PAN_ARROW_RATE, 0)}
                  onPointerUp={releaseArrow}
                  onPointerLeave={releaseArrow}
                  onClick={(e) => {
                    if (e.detail === 0) nudgePan(-1, 0);
                  }}
                >
                  ◀
                </PanArrow>
                <PanArrow
                  type="button"
                  $dir="right"
                  aria-label="Pan right"
                  onPointerDown={() => startArrow(PAN_ARROW_RATE, 0)}
                  onPointerUp={releaseArrow}
                  onPointerLeave={releaseArrow}
                  onClick={(e) => {
                    if (e.detail === 0) nudgePan(1, 0);
                  }}
                >
                  ▶
                </PanArrow>
                <PanBall
                  aria-hidden="true"
                  title="Drag to pan"
                  onPointerDown={handleBallDown}
                  onPointerMove={handleBallMove}
                  onPointerUp={handleBallUp}
                  onPointerCancel={handleBallUp}
                  style={{
                    transform: `translate(${ballPos.x}px, ${ballPos.y}px)`,
                  }}
                />
              </PanControl>
            )}
          </>
        )}
      </VideoWrap>
    </Panel>
  );
}

// ZoomControlsWrap and PanControl defined BEFORE VideoWrap so VideoWrap
// can reference them in hover/focus-within selectors.

// Pan directional pad — four arrows around a draggable rate ball, on a faint
// circular guide ring. Less boxy than the old square crosshair pad; revealed
// on hover/focus like the zoom control.
const PanControl = styled.div`
  position: absolute;
  bottom: 8px;
  right: 8px;
  width: 92px;
  height: 92px;
  opacity: 0;
  transition: opacity 0.15s;
  touch-action: none;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

const PanRing = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  width: 60px;
  height: 60px;
  transform: translate(-50%, -50%);
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 50%;
`;

const PanArrow = styled.button<{ $dir: "up" | "down" | "left" | "right" }>`
  position: absolute;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 11px;
  line-height: 1;
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 3px;
  cursor: pointer;
  touch-action: none;

  ${(p) =>
    p.$dir === "up"
      ? "top: 0; left: 50%; transform: translateX(-50%);"
      : p.$dir === "down"
        ? "bottom: 0; left: 50%; transform: translateX(-50%);"
        : p.$dir === "left"
          ? "left: 0; top: 50%; transform: translateY(-50%);"
          : "right: 0; top: 50%; transform: translateY(-50%);"}

  @media (hover: hover) {
    &:hover:not(:disabled) {
      background: rgba(0, 0, 0, 0.75);
    }
  }
  &:disabled {
    opacity: 0.3;
    cursor: default;
  }
  &:focus-visible {
    outline: 2px solid #00ff88;
    outline-offset: 2px;
  }
`;

const PanBall = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  width: 20px;
  height: 20px;
  margin: -10px 0 0 -10px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #ffffff, #cfd5dc);
  box-shadow: 0 0 6px rgba(255, 255, 255, 0.55);
  cursor: grab;
  touch-action: none;

  &:active {
    cursor: grabbing;
  }
`;

// Map-style zoom: a compact +/- stack tucked into the bottom-left corner,
// revealed on hover/focus like the pan pad — not a slider across the stream.
const ZoomControlsWrap = styled.div`
  position: absolute;
  bottom: 8px;
  left: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

// Reuses the @gonogo/ui IconButton, dressed as a map control: a legible dark
// wash + light glyph so it reads over any video frame, not the faint
// on-surface styling.
const ZoomButton = styled(IconButton)`
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 3px;
  color: #fff;
  font-size: 1rem;

  @media (hover: hover) {
    &:hover {
      color: #fff;
      background: rgba(0, 0, 0, 0.8);
    }
  }

  &:focus-visible {
    outline: 2px solid #00ff88;
    outline-offset: 2px;
  }
`;

const VideoWrap = styled.div`
  position: relative;
  background: #000;
  border-radius: 4px;
  overflow: hidden;
  aspect-ratio: 1 / 1;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover ${ZoomControlsWrap},
  &:hover ${PanControl},
  &:focus-within ${ZoomControlsWrap},
  &:focus-within ${PanControl} {
    opacity: 1;
  }
`;

const Empty = styled.div`
  color: #888;
  font-size: 13px;
  font-style: italic;
  padding: 1rem;
  text-align: center;
`;

const SelectionBar = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0;
`;

const CameraPickerLabel = styled.label`
  font-size: 11px;
  color: var(--color-text-dim);
  text-transform: uppercase;
  letter-spacing: 0.06em;
`;

// Reuses the shared @gonogo/ui Select (inputBase styling + focus ring); the
// toolbar just needs it to flex within the SelectionBar rather than fill 100%.
const CameraSelect = styled(Select)`
  flex: 1;
  min-width: 0;
  width: auto;
`;

const StyledVideo = styled.video<{ $destroyed: boolean }>`
  width: 100%;
  height: 100%;
  object-fit: contain;
  ${({ $destroyed }) =>
    $destroyed &&
    css`
      filter: grayscale(1) brightness(0.45);
    `}
`;

/**
 * Full-frame overlay shown when the sidecar reports `lifecycle: "destroyed"`.
 * Keeps the last decoded frame visible behind it (HTML video element retains
 * the final frame naturally). The video element is additionally desaturated
 * and dimmed via CSS filter so the overlay reads clearly.
 */
const SignalLostOverlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
`;

const SignalLostText = styled.span`
  color: #ff4444;
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  text-shadow:
    0 0 8px rgba(255, 68, 68, 0.7),
    0 1px 2px rgba(0, 0, 0, 0.9);

  /* Suppress the pulse animation when the user prefers reduced motion. */
  @media (prefers-reduced-motion: no-preference) {
    animation: signal-lost-pulse 2s ease-in-out infinite;
  }

  @keyframes signal-lost-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.6;
    }
  }
`;
