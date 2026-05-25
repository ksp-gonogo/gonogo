import { Panel, PanelSubtitle, PanelTitle } from "@gonogo/ui";
import { useEffect, useRef } from "react";
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

  return (
    <Panel>
      <PanelTitle>{camera?.cameraName ?? "Camera Feed (exp)"}</PanelTitle>
      {camera ? (
        <PanelSubtitle>
          {camera.vesselName} · {camera.renderWidth}×{camera.renderHeight}
        </PanelSubtitle>
      ) : (
        <PanelSubtitle>waiting for sidecar handshake…</PanelSubtitle>
      )}
      <VideoWrap>
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
          </>
        )}
      </VideoWrap>
    </Panel>
  );
}

const VideoWrap = styled.div`
  position: relative;
  background: #000;
  border-radius: 4px;
  overflow: hidden;
  aspect-ratio: 1 / 1;
  display: flex;
  align-items: center;
  justify-content: center;
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
