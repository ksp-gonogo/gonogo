/**
 * CameraSetpointSurface: the delayed-camera control surface. Below the staged
 * delay threshold (`mode === "live"`) it renders nothing and the SDK's built-in
 * live pan/zoom controls stay in charge. At or above the threshold it takes
 * over: the operator dials an absolute yaw/pitch/fov target on the
 * `CameraSetpointInput`, reviews it against the current framing on the
 * `FramingPreview`, and commits ONE delayed command per axis-group through the
 * Sitrep command Courier (`kerbcast.setPan` + `kerbcast.setFieldOfView`, both
 * already `Delayed`). Under `no-path` the surface still shows but the commit is
 * gated, consistent with any uplink command under signal loss.
 *
 * Bounds + the seed setpoint come in as props (the host `CameraFeed` reads them
 * off the live `CameraState`), so this component stays headless-testable with
 * no kerbcast client.
 */

import { useCommand } from "@ksp-gonogo/sitrep-sdk";
import {
  Box,
  type CameraSetpoint,
  type CameraSetpointBounds,
  CameraSetpointInput,
  CommandDelay,
  Stack,
} from "@ksp-gonogo/ui-kit";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { FramingPreview } from "./FramingPreview";

/** Sitrep command ids (string literals, not exported from the SDK in TS). */
const SET_PAN = "kerbcast.setPan";
const SET_FOV = "kerbcast.setFieldOfView";

/** Fixed preview box (px). The feed frame never resizes; only the target does. */
const PREVIEW_WIDTH = 220;
const PREVIEW_HEIGHT = 132;

/** Local morph duration, kept in step with FramingPreview's `--duration-slow`. */
const MORPH_MS = 450;

export interface CameraSetpointSurfaceProps {
  /** KSP `Part.flightID` of the camera under control (the effective displayed id). */
  cameraId: number;
  bounds: CameraSetpointBounds;
  /** Seed setpoint from the current `CameraState` (`panYaw`/`panPitch`/`fov`). */
  initial: CameraSetpoint;
  mode: "live" | "staged" | "no-path";
}

export function CameraSetpointSurface({
  cameraId,
  bounds,
  initial,
  mode,
}: CameraSetpointSurfaceProps): JSX.Element | null {
  const [setpoint, setSetpoint] = useState<CameraSetpoint>(initial);
  const [committing, setCommitting] = useState(false);
  const morphTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Two delayed commands, one per axis-group. Held unconditionally (rules of
  // hooks) even in `live` mode where the surface renders nothing.
  const setPan = useCommand(SET_PAN);
  const setFov = useCommand(SET_FOV);

  useEffect(
    () => () => {
      if (morphTimerRef.current !== null) clearTimeout(morphTimerRef.current);
    },
    [],
  );

  // Commit dispatches BOTH absolute delayed commands (one pan vector + one FOV
  // scalar) through the Sitrep Courier, then runs the local confirm morph.
  // CommandGroup already blocks the commit while gated (`no-path`), so no extra
  // guard is needed here. Degrees are plain numbers, absolute (not rates).
  const handleCommit = (next: CameraSetpoint): void => {
    setPan.send({ cameraId, yaw: next.yaw, pitch: next.pitch }).catch(() => {});
    setFov.send({ cameraId, fieldOfView: next.fov }).catch(() => {});
    setCommitting(true);
    if (morphTimerRef.current !== null) clearTimeout(morphTimerRef.current);
    morphTimerRef.current = setTimeout(() => setCommitting(false), MORPH_MS);
  };

  if (mode === "live") return null;

  return (
    <Box
      surface="panel"
      pad="sm"
      radius="md"
      bordered
      style={SURFACE_STYLE}
      aria-label="Delayed camera control"
    >
      <Stack gap="sm">
        <FramingPreview
          setpoint={setpoint}
          bounds={bounds}
          width={PREVIEW_WIDTH}
          height={PREVIEW_HEIGHT}
          committing={committing}
        />
        <CameraSetpointInput
          value={setpoint}
          bounds={bounds}
          gated={mode === "no-path"}
          gatedReason="No signal path"
          onChange={setSetpoint}
          onCommit={handleCommit}
        />
        <CommandDelay handles={[setPan, setFov]} />
      </Stack>
    </Box>
  );
}

const SURFACE_STYLE: CSSProperties = {
  pointerEvents: "auto",
  width: "max-content",
  maxWidth: "100%",
};
