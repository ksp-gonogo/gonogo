import { Panel, PanelSubtitle, PanelTitle } from "@gonogo/ui";
import { useEffect, useRef } from "react";
import styled from "styled-components";
import { useKerbcamCameras } from "../hooks/useKerbcamCameras";
import { useKerbcamStream } from "../hooks/useKerbcamStream";

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
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            controls={false}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
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
