import type { ActionDefinition, ComponentProps } from "@gonogo/core";
import { useActionInput, useDataValue, useExecuteAction } from "@gonogo/core";
import {
  IconButton,
  Panel,
  PanelSubtitle,
  PanelTitle,
  Select,
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
import { isCameraDestroyed } from "../lifecycle";

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

export interface CameraFeedConfig extends Record<string, unknown> {
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
export const cameraFeedActions = [
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
  {
    id: "zoomIn",
    label: "Zoom in",
    accepts: ["button"],
    description: "Zoom in one step (reduces field of view by 5°).",
  },
  {
    id: "zoomOut",
    label: "Zoom out",
    accepts: ["button"],
    description: "Zoom out one step (increases field of view by 5°).",
  },
  {
    id: "panYaw",
    label: "Pan yaw axis",
    accepts: ["analog"],
    description:
      "Analog yaw pan rate. Positive = pan right, negative = pan left. Maps −1…1 to the camera's max pan speed.",
  },
  {
    id: "panPitch",
    label: "Pan pitch axis",
    accepts: ["analog"],
    description:
      "Analog pitch pan rate. Positive = pan up, negative = pan down. No-op if the camera does not support pitch. Maps −1…1 to the camera's max pan speed.",
  },
] as const satisfies readonly ActionDefinition[];

export type CameraFeedActions = typeof cameraFeedActions;

/** Round n to the nearest even integer, minimum 2 (H.264 chroma requirement). */
function toEvenPx(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

export function CameraFeed({
  config,
  onConfigChange,
}: Readonly<ComponentProps<CameraFeedConfig>>) {
  const cameras = useKerbcamCameras();
  const requested = config?.flightId ?? null;

  // --------------------------------------------------------------------------
  // Selection model.
  //
  // `config.flightId` is the single source of truth for an *explicit* pick;
  // `null` means "auto". Resolution order:
  //   1. Explicit pick, if still present in the list (destroyed or not) — the
  //      operator chose it, so we honour it even after the part blows up.
  //   2. Auto: *latch* onto whatever's currently on screen. Once a camera is
  //      displayed we keep showing it even if it becomes destroyed, so a feed
  //      the operator is watching never silently jumps to a sibling or vanishes
  //      when its part is destroyed. The latch only releases when that camera
  //      leaves the list entirely (vessel change).
  //   3. Fresh auto-pick (nothing latched / latched camera gone): prefer the
  //      first *live* camera — a destroyed one makes a poor default. Fall back
  //      to the first camera overall only if every camera is destroyed, so the
  //      widget shows a SIGNAL LOST feed rather than "no cameras".
  //
  // The latch needs a render-time ref read (what's currently displayed is
  // historical state, not derivable from cameras+config alone); it's committed
  // in an effect below.
  // --------------------------------------------------------------------------
  const displayedRef = useRef<number | null>(null);
  const requestedStillPresent =
    requested !== null && cameras.some((c) => c.flightId === requested);

  let flightId: number | null;
  if (requestedStillPresent) {
    flightId = requested;
  } else {
    const latched = displayedRef.current;
    const latchedPresent =
      latched !== null && cameras.some((c) => c.flightId === latched);
    flightId = latchedPresent
      ? latched
      : (cameras.find((c) => !isCameraDestroyed(c))?.flightId ??
        cameras[0]?.flightId ??
        null);
  }

  const camera =
    flightId !== null
      ? (cameras.find((c) => c.flightId === flightId) ?? null)
      : null;

  // Commit the on-screen camera for the auto-mode latch above.
  useEffect(() => {
    displayedRef.current = flightId;
  }, [flightId]);

  // Connection status is intentionally NOT shown here — it lives in the Data
  // Sources widget (and a disconnect surfaces as a banner). This widget only
  // shows cameras-or-none, so the operator isn't asked to reason about
  // transport details at the feed level.

  const stream = useKerbcamStream(flightId);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const isDestroyed = camera ? isCameraDestroyed(camera) : false;

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

  useActionInput<CameraFeedActions>({
    nextCamera: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return;
      stepCamera(1);
    },
    prevCamera: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return;
      stepCamera(-1);
    },
    zoomIn: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return;
      if (!camera?.supportsZoom || isDestroyed) return;
      onFovChange(camera.fov - 5);
    },
    zoomOut: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return;
      if (!camera?.supportsZoom || isDestroyed) return;
      onFovChange(camera.fov + 5);
    },
    panYaw: (payload) => {
      if (payload.kind !== "analog") return;
      if (!showPan) return;
      rateRef.current.yaw = Math.max(-1, Math.min(1, payload.value as number));
      if (rateRef.current.yaw !== 0) ensurePanLoop();
    },
    panPitch: (payload) => {
      if (payload.kind !== "analog") return;
      if (!showPan || !supportsPitch) return;
      rateRef.current.pitch = Math.max(
        -1,
        Math.min(1, payload.value as number),
      );
      if (rateRef.current.pitch !== 0) ensurePanLoop();
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
      const { width } = entry.contentRect;
      if (resizeTimerRef.current !== null) clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(() => {
        // Always request a 16:9 frame (height derived from width) so KSP renders
        // a widescreen feed regardless of the widget's grid proportions, rather
        // than an arbitrary aspect that'd letterbox or distort in the player.
        const w = toEvenPx(width);
        const h = toEvenPx((width * 9) / 16);
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

  // Unique per widget instance so two CameraFeeds on one dashboard don't
  // produce duplicate ids (which would break the label→select association).
  const selectId = useId();

  return (
    <Panel>
      <PanelTitle>{camera?.cameraName ?? "Camera Feed"}</PanelTitle>
      {camera ? (
        <PanelSubtitle>
          {camera.vesselName} · {camera.renderWidth}×{camera.renderHeight}
          {bitrateLabel}
          {adaptiveLabel}
        </PanelSubtitle>
      ) : (
        <PanelSubtitle>no cameras on this vessel</PanelSubtitle>
      )}

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
                {isCameraDestroyed(c) ? " — signal lost" : ""}
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
            No camera feeds — start a vessel with Hullcam parts installed
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

// Pan directional pad — four bare arrow glyphs around a small draggable rate
// ball. A dark drop-shadow (not a box) keeps the white glyphs + ball legible
// over a bright frame. Revealed on hover/focus like the zoom control.
const PanControl = styled.div`
  position: absolute;
  bottom: 10px;
  right: 10px;
  width: 52px;
  height: 52px;
  opacity: 0;
  transition: opacity 0.15s;
  touch-action: none;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

const PanArrow = styled.button<{ $dir: "up" | "down" | "left" | "right" }>`
  position: absolute;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 11px;
  line-height: 1;
  color: #fff;
  opacity: 0.5;
  background: none;
  border: none;
  cursor: pointer;
  touch-action: none;
  /* Dark halo keeps the white glyph legible over a bright frame, no box. */
  text-shadow:
    0 0 3px rgba(0, 0, 0, 0.9),
    0 1px 2px rgba(0, 0, 0, 0.8);

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
      opacity: 1;
      color: #00ff88;
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
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #ffffff, #d6dbe1);
  /* Thin dark ring for contrast over a bright frame + a faint glow over dark. */
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.5),
    0 0 4px rgba(255, 255, 255, 0.4);
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
  aspect-ratio: 16 / 9;
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
