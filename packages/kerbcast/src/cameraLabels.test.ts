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

  it("numbers colliding cameras that have no part title, by flightId order", () => {
    // Upstream behaviour since @jonpepler/kerbcast-react 0.20: identical
    // labels that can't be disambiguated by part title get a stable
    // "#n" suffix ordered by flightId, instead of staying ambiguous.
    const cameras = [cam(2, "NavCam"), cam(1, "NavCam")];
    const label = buildCameraLabeler(cameras);
    expect(label(cameras[1])).toBe("NavCam #1");
    expect(label(cameras[0])).toBe("NavCam #2");
  });
});
