import { describe, expect, it } from "vitest";
import { buildCameraLabeler, type LabelableCamera } from "./cameraLabels";

const cam = (
  flightId: number,
  cameraName: string,
  partTitle?: string,
): LabelableCamera => ({ flightId, cameraName, partTitle });

describe("buildCameraLabeler", () => {
  it("leaves uniquely-named cameras as their bare cameraName", () => {
    const label = buildCameraLabeler([
      cam(1, "NavCam", "NavCam"),
      cam(2, "TurretCam", "TurretCam"),
    ]);
    expect(label(cam(1, "NavCam", "NavCam"))).toBe("NavCam");
    expect(label(cam(2, "TurretCam", "TurretCam"))).toBe("TurretCam");
  });

  it("appends the part title only for cameras whose name collides", () => {
    const cameras = [
      cam(1, "NavCam", "NavCam"),
      cam(2, "NavCam", "Clamp-O-Tron Docking Port Jr."),
      cam(3, "TailCam", "Some Other Part"),
    ];
    const label = buildCameraLabeler(cameras);
    // Colliding pair: the one whose title differs gets disambiguated; the one
    // whose title equals its name stays bare.
    expect(label(cameras[0])).toBe("NavCam");
    expect(label(cameras[1])).toBe("NavCam - Clamp-O-Tron Docking Port Jr.");
    // No collision → bare name even though the part title differs.
    expect(label(cameras[2])).toBe("TailCam");
  });

  it("falls back to the bare name when a colliding camera has no part title", () => {
    const cameras = [cam(1, "NavCam"), cam(2, "NavCam")];
    const label = buildCameraLabeler(cameras);
    expect(label(cameras[0])).toBe("NavCam");
    expect(label(cameras[1])).toBe("NavCam");
  });
});
