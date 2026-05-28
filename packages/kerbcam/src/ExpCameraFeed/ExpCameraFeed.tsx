import { useDataValue, useExecuteAction } from "@gonogo/core";
import { Panel, PanelSubtitle, PanelTitle } from "@gonogo/ui";
import { useCallback, useEffect, useRef } from "react";
import styled, { css } from "styled-components";
import { useKerbcamCameras } from "../hooks/useKerbcamCameras";
import { useKerbcamStream } from "../hooks/useKerbcamStream";
import { getCameraLifecycle } from "../lifecycle";

export interface ExpCameraFeedConfig extends Record<string, unknown> {
  /**
   * KSP `Part.flightID` of the camera to stream. `null` (the
   * default) auto-picks the first available — handy for "drop the
   * widget on a dashboard and it just works" during early testing,
   * fragile once the operator wants a specific camera.
   */
  flightId: number | null;
}

export interface ExpCameraFeedProps {
  config?: ExpCameraFeedConfig;
}

/** Round n to the nearest even integer, minimum 2 (H.264 chroma requirement). */
function toEvenPx(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

export function ExpCameraFeed({ config }: ExpCameraFeedProps) {
  const cameras = useKerbcamCameras();
  const requested = config?.flightId ?? null;

  // Auto-pick the first available camera when no explicit flight ID
  // is configured. Locks in the first one we see so subsequent
  // camera list updates (vessel changes adding/removing cameras)
  // don't churn the stream — but flips to the new first if the
  // current selection disappears.
  const autoPickedRef = useRef<number | null>(null);
  if (requested === null && cameras.length > 0) {
    if (
      autoPickedRef.current === null ||
      !cameras.find((c) => c.flightId === autoPickedRef.current)
    ) {
      autoPickedRef.current = cameras[0]?.flightId ?? null;
    }
  } else if (requested !== null) {
    autoPickedRef.current = requested;
  } else {
    autoPickedRef.current = null;
  }
  const flightId = autoPickedRef.current;

  const stream = useKerbcamStream(flightId);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const camera =
    flightId !== null ? cameras.find((c) => c.flightId === flightId) : null;

  const lifecycle = camera ? getCameraLifecycle(camera) : "active";
  const isDestroyed = lifecycle === "destroyed";

  const executeKerbcam = useExecuteAction("kerbcam");

  // --------------------------------------------------------------------------
  // Feature 1: Render-size feedback (ResizeObserver, 500ms debounce)
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
  // Feature 2: CommNet signal degrade (500ms debounce)
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
  // Feature 3: Zoom controls (FoV) — handler
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
  // Derived subtitle parts
  // --------------------------------------------------------------------------
  const bitrateLabel =
    camera && camera.encoderBitrateBps > 0
      ? ` · ${Math.round(camera.encoderBitrateBps / 1000)}kbps`
      : "";
  const adaptiveLabel =
    camera && camera.renderWidth < camera.operatorWidth ? " · adaptive" : "";

  const showZoom =
    camera !== null &&
    camera !== undefined &&
    camera.supportsZoom &&
    !isDestroyed;

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
        <PanelSubtitle>waiting for sidecar handshake…</PanelSubtitle>
      )}
      <VideoWrap ref={wrapRef}>
        {flightId === null ? (
          <Empty>
            {cameras.length === 0
              ? "no cameras detected — is the kerbcam sidecar running?"
              : "pick a camera in widget settings"}
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
          </>
        )}
      </VideoWrap>
    </Panel>
  );
}

// ZoomControlsWrap defined BEFORE VideoWrap so VideoWrap can reference it
// in hover/focus-within selectors.
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
  &:focus-within ${ZoomControlsWrap} {
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
