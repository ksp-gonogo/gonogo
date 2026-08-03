/**
 * Pure framing geometry for the delayed-camera setpoint preview. Maps a
 * `CameraSetpoint` (yaw/pitch/fov) against its bounds onto a fixed, centred
 * feed-frame px box: the target sub-region the dialled setpoint will frame.
 * No React, no side effects, so the transform is unit-testable in isolation.
 *
 * Rules (design): pan offsets the target centre (yaw to x, pitch to y, each as
 * a fraction of its pan range); zoom resizes it (smaller FOV, smaller
 * sub-region, `fov / midFov`); an off-boresight fisheye bulges the corners
 * outward as the centre moves off the frame centre. The bulge is a
 * centroid-preserving radial scale (a symmetric outward push), so the mean of
 * the four corners stays exactly the target centre.
 */

import type { CameraSetpoint, CameraSetpointBounds } from "@ksp-gonogo/ui-kit";

export interface FrameCorners {
  tl: [number, number];
  tr: [number, number];
  br: [number, number];
  bl: [number, number];
}
export interface TargetFraming {
  corners: FrameCorners;
  centroid: [number, number];
}

/** Outward corner bulge per unit of off-centre fraction (0 at boresight). */
const FISHEYE_K = 0.5;

export function computeTargetFraming(
  setpoint: CameraSetpoint,
  bounds: CameraSetpointBounds,
  frameSize: { width: number; height: number },
): TargetFraming {
  const { width, height } = frameSize;
  const { yaw, pitch, fov } = setpoint;

  const yawMid = (bounds.yawMin + bounds.yawMax) / 2;
  const pitchMid = (bounds.pitchMin + bounds.pitchMax) / 2;
  const yawRange = bounds.yawMax - bounds.yawMin || 1;
  const pitchRange = bounds.pitchMax - bounds.pitchMin || 1;

  // Pan: pixel offset of the target centre from the frame centre.
  const xOffset = ((yaw - yawMid) / yawRange) * width;
  const yOffset = ((pitch - pitchMid) / pitchRange) * height;
  const centreX = width / 2 + xOffset;
  const centreY = height / 2 + yOffset;

  // Zoom: smaller FOV frames a smaller sub-region (r < 1). Clamp to a sane band.
  const midFov = (bounds.fovMin + bounds.fovMax) / 2 || 1;
  const r = Math.min(2, Math.max(0.1, fov / midFov));
  const halfW = (width / 2) * r;
  const halfH = (height / 2) * r;

  // Fisheye: a centroid-preserving radial bulge that grows with off-boresight
  // distance, so the corners curve outward as the pan moves off-centre.
  const maxOff = Math.hypot(width / 2, height / 2) || 1;
  const offCentreFraction = Math.min(1, Math.hypot(xOffset, yOffset) / maxOff);
  const skew = 1 + FISHEYE_K * offCentreFraction;

  const corner = (dx: number, dy: number): [number, number] => [
    centreX + dx * skew,
    centreY + dy * skew,
  ];
  const corners: FrameCorners = {
    tl: corner(-halfW, -halfH),
    tr: corner(halfW, -halfH),
    br: corner(halfW, halfH),
    bl: corner(-halfW, halfH),
  };
  const centroid: [number, number] = [
    (corners.tl[0] + corners.tr[0] + corners.br[0] + corners.bl[0]) / 4,
    (corners.tl[1] + corners.tr[1] + corners.br[1] + corners.bl[1]) / 4,
  ];
  return { corners, centroid };
}
