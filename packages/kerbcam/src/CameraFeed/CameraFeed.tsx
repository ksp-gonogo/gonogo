import type { ActionDefinition, ComponentProps } from "@gonogo/core";
import { getDataSource, useActionInput, useDataValue } from "@gonogo/core";
import {
  type CameraFeedHandle,
  KerbcamProvider,
  type KerbcamSubscriptions,
  CameraFeed as SharedCameraFeed,
} from "@jonpepler/kerbcam-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KerbcamDataSource } from "../KerbcamDataSource";

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
  /**
   * When true, the feed renders the technical readouts (resolution +
   * encoder bitrate) in the top overlay. Defaults to `false` so the
   * default chrome stays uncluttered; toggled from the camera menu.
   */
  showDebugInfo: boolean;
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
    description: "Zoom in one step (reduces field of view by 5 degrees).",
  },
  {
    id: "zoomOut",
    label: "Zoom out",
    accepts: ["button"],
    description: "Zoom out one step (increases field of view by 5 degrees).",
  },
  {
    id: "panYaw",
    label: "Pan yaw axis",
    accepts: ["analog"],
    description:
      "Analog yaw pan rate. Positive = pan right, negative = pan left. Maps -1..1 to the camera's max pan speed.",
  },
  {
    id: "panPitch",
    label: "Pan pitch axis",
    accepts: ["analog"],
    description:
      "Analog pitch pan rate. Positive = pan up, negative = pan down. No-op if the camera does not support pitch. Maps -1..1 to the camera's max pan speed.",
  },
] as const satisfies readonly ActionDefinition[];

export type CameraFeedActions = typeof cameraFeedActions;

export function CameraFeed({
  config,
  onConfigChange,
}: Readonly<ComponentProps<CameraFeedConfig>>) {
  const ds = getDataSource("kerbcam") as KerbcamDataSource | undefined;
  const client = ds?.getClient();

  // Ensure the sidecar connection is open before we render.
  useEffect(() => {
    ds?.ensureConnected();
  }, [ds]);

  // Build the subscriptions adapter once per data source so acquire/release
  // calls are stable across re-renders.
  const subscriptions: KerbcamSubscriptions | undefined = useMemo(
    () =>
      ds
        ? {
            acquire: ds.subscribeCamera.bind(ds),
            release: ds.unsubscribeCamera.bind(ds),
          }
        : undefined,
    [ds],
  );

  const requested = config?.flightId ?? null;
  const showDebugInfo = config?.showDebugInfo ?? false;

  // Internal ref driving the shared component's handle (pan/zoom serial
  // actions). Nothing outside this component holds a ref to CameraFeed.
  const feedRef = useRef<CameraFeedHandle>(null);

  // ---- Serial-input actions ----
  // stepCamera, setZoomRate and setPanAxis are guarded internally by the
  // shared component (showZoom / showPan / supportsPitch checks), so the
  // handlers here can call them unconditionally.
  useActionInput<CameraFeedActions>({
    nextCamera: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return;
      feedRef.current?.stepCamera(1);
    },
    prevCamera: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return;
      feedRef.current?.stepCamera(-1);
    },
    zoomIn: (payload) => {
      if (payload.kind !== "button") return;
      feedRef.current?.setZoomRate(payload.value === true ? 1 : 0);
    },
    zoomOut: (payload) => {
      if (payload.kind !== "button") return;
      feedRef.current?.setZoomRate(payload.value === true ? -1 : 0);
    },
    panYaw: (payload) => {
      if (payload.kind !== "analog") return;
      feedRef.current?.setPanAxis("yaw", payload.value as number);
    },
    panPitch: (payload) => {
      if (payload.kind !== "analog") return;
      feedRef.current?.setPanAxis("pitch", payload.value as number);
    },
  });

  // ---- CommNet degrade (500ms debounce) ----
  // In auto mode (config.flightId === null) the shared component picks the
  // displayed camera itself, and that pick can differ from config.flightId.
  // Rather than re-derive the same auto-latch resolution here, let the shared
  // component report what it actually shows via onDisplayedCameraChange so
  // degrade always targets the feed on screen (auto-picks included).
  const [effectiveFlightId, setEffectiveFlightId] = useState<number | null>(
    requested,
  );

  const signalStrength = useDataValue<number>("data", "comm.signalStrength");
  const commConnected = useDataValue<boolean>("data", "comm.connected");
  const degradeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (effectiveFlightId === null || !client) return;
    // If both values are undefined, CommNet data isn't available -- skip.
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
      void client.camera(effectiveFlightId as number).setDegrade(level);
    }, 500);

    return () => {
      if (degradeTimerRef.current !== null)
        clearTimeout(degradeTimerRef.current);
    };
  }, [effectiveFlightId, signalStrength, commConnected, client]);

  if (!client || !subscriptions) return null;

  return (
    <KerbcamProvider client={client} subscriptions={subscriptions}>
      <SharedCameraFeed
        ref={feedRef}
        flightId={requested}
        onSelectCamera={(nextFlightId) =>
          onConfigChange?.({
            flightId: nextFlightId,
            showDebugInfo: config?.showDebugInfo ?? false,
          })
        }
        onDisplayedCameraChange={setEffectiveFlightId}
        showDebugInfo={showDebugInfo}
        enableFullscreen
        enablePictureInPicture
      />
    </KerbcamProvider>
  );
}
