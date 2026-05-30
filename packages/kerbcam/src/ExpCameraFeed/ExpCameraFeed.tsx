import type { ActionDefinition, ComponentProps } from "@gonogo/core";
import {
  useActionInput,
  useDataSources,
  useDataValue,
  useExecuteAction,
} from "@gonogo/core";
import {
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

  // Display position tracks camera state; overridden locally during a drag so
  // the dot moves immediately without waiting for the sidecar round-trip.
  const [displayYaw, setDisplayYaw] = useState(0);
  const [displayPitch, setDisplayPitch] = useState(0);
  const panDragRef = useRef<{
    active: boolean;
    startClientX: number;
    startClientY: number;
    startYaw: number;
    startPitch: number;
  }>({
    active: false,
    startClientX: 0,
    startClientY: 0,
    startYaw: 0,
    startPitch: 0,
  });
  const panThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panPadRef = useRef<HTMLDivElement>(null);

  // Sync display from camera state when not mid-drag.
  useEffect(() => {
    if (!panDragRef.current.active && camera) {
      setDisplayYaw(camera.panYaw);
      setDisplayPitch(camera.panPitch);
    }
  }, [camera]);

  const handlePanPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!camera || flightId === null) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      panDragRef.current = {
        active: true,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startYaw: camera.panYaw,
        startPitch: camera.panPitch,
      };
    },
    [camera, flightId],
  );

  const handlePanPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (
        !panDragRef.current.active ||
        !camera ||
        !panPadRef.current ||
        flightId === null
      )
        return;
      const { width, height } = panPadRef.current.getBoundingClientRect();
      const dx = e.clientX - panDragRef.current.startClientX;
      const dy = e.clientY - panDragRef.current.startClientY;
      const yawRange = camera.panYawMax - camera.panYawMin || 1;
      const pitchRange = camera.panPitchMax - camera.panPitchMin || 1;
      const newYaw = Math.max(
        camera.panYawMin,
        Math.min(
          camera.panYawMax,
          panDragRef.current.startYaw + (dx / width) * yawRange,
        ),
      );
      const newPitch = Math.max(
        camera.panPitchMin,
        Math.min(
          camera.panPitchMax,
          panDragRef.current.startPitch - (dy / height) * pitchRange,
        ),
      );
      setDisplayYaw(newYaw);
      setDisplayPitch(newPitch);
      if (panThrottleRef.current === null) {
        panThrottleRef.current = setTimeout(() => {
          panThrottleRef.current = null;
          void executeKerbcam(
            `kerbcam.set-pan[${flightId},${newYaw},${newPitch}]`,
          );
        }, 50);
      }
    },
    [camera, flightId, executeKerbcam],
  );

  const handlePanPointerUp = useCallback(() => {
    panDragRef.current.active = false;
  }, []);

  const showPan = camera?.supportsPan && !isDestroyed;

  // Dot position within the 80×80 pad. Pitch Y is inverted (up = positive pitch).
  const panDotX = camera
    ? ((displayYaw - camera.panYawMin) /
        (camera.panYawMax - camera.panYawMin || 1)) *
      70
    : 35;
  const panDotY = camera
    ? ((camera.panPitchMax - displayPitch) /
        (camera.panPitchMax - camera.panPitchMin || 1)) *
      70
    : 35;

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
          <StepButton
            type="button"
            aria-label="Previous camera"
            disabled={!canStep}
            onClick={() => stepCamera(-1)}
          >
            ‹
          </StepButton>
          <StepButton
            type="button"
            aria-label="Next camera"
            disabled={!canStep}
            onClick={() => stepCamera(1)}
          >
            ›
          </StepButton>
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
                <button
                  type="button"
                  aria-label="Zoom out"
                  onClick={() => onFovChange(camera.fov + 5)}
                >
                  −
                </button>
                <input
                  type="range"
                  min={camera.fovMin}
                  max={camera.fovMax}
                  step={1}
                  value={camera.fov}
                  aria-label={`Field of view: ${camera.fov}°`}
                  onChange={(e) => onFovChange(Number(e.target.value))}
                />
                <button
                  type="button"
                  aria-label="Zoom in"
                  onClick={() => onFovChange(camera.fov - 5)}
                >
                  +
                </button>
              </ZoomControlsWrap>
            )}
            {showPan && (
              <PanPadWrap
                ref={panPadRef}
                role="slider"
                aria-label="Pan camera"
                aria-valuenow={displayYaw}
                tabIndex={0}
                onPointerDown={handlePanPointerDown}
                onPointerMove={handlePanPointerMove}
                onPointerUp={handlePanPointerUp}
                onPointerCancel={handlePanPointerUp}
              >
                <PanDot style={{ left: panDotX, top: panDotY }} />
              </PanPadWrap>
            )}
          </>
        )}
      </VideoWrap>
    </Panel>
  );
}

// ZoomControlsWrap and PanPadWrap defined BEFORE VideoWrap so VideoWrap
// can reference them in hover/focus-within selectors.

const PanDot = styled.div`
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #00ff88;
  box-shadow: 0 0 4px rgba(0, 255, 136, 0.7);
  transform: translate(-50%, -50%);
  pointer-events: none;
`;

const PanPadWrap = styled.div`
  position: absolute;
  bottom: 44px; /* sits above the zoom bar */
  right: 8px;
  width: 80px;
  height: 80px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  cursor: crosshair;
  touch-action: none;
  opacity: 0;
  transition: opacity 0.15s;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }

  &:focus-visible {
    outline: 2px solid #00ff88;
    outline-offset: 2px;
  }

  /* Crosshair reference lines */
  &::before,
  &::after {
    content: "";
    position: absolute;
    background: rgba(255, 255, 255, 0.2);
  }
  &::before {
    left: 50%;
    top: 0;
    bottom: 0;
    width: 1px;
  }
  &::after {
    top: 50%;
    left: 0;
    right: 0;
    height: 1px;
  }
`;

const ZoomControlsWrap = styled.div`
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.55);
  opacity: 0;
  transition: opacity 0.15s;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }

  button {
    background: rgba(255, 255, 255, 0.15);
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 3px;
    color: #fff;
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
    padding: 2px 7px;

    &:focus-visible {
      outline: 2px solid #00ff88;
      outline-offset: 2px;
    }
  }

  input[type="range"] {
    flex: 1;
    accent-color: #00ff88;

    &:focus-visible {
      outline: 2px solid #00ff88;
      outline-offset: 2px;
    }
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
  &:hover ${PanPadWrap},
  &:focus-within ${ZoomControlsWrap},
  &:focus-within ${PanPadWrap} {
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

const StepButton = styled.button`
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-subtle);
  border-radius: 3px;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  padding: 2px 9px;

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }

  &:focus-visible {
    outline: 2px solid #00ff88;
    outline-offset: 2px;
  }
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
