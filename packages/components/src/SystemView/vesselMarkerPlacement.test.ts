import { describe, expect, it } from "vitest";
import {
  MARKER_CROWD_THRESHOLD_PX,
  resolveVesselMarkerPlacement,
} from "./SystemDiagram";

describe("resolveVesselMarkerPlacement", () => {
  it("renders on the true position when it's well clear of the parent", () => {
    // 40 user-units at zoom 1 is 40 screen px, comfortably clear.
    const placement = resolveVesselMarkerPlacement({ x: 40, y: 0 }, 1);
    expect(placement.marker).toEqual({ x: 40, y: 0 });
    expect(placement.leaderFrom).toBeNull();
  });

  it("offsets the marker along the parent->vessel direction when crowded", () => {
    // 2 user-units at zoom 1 is 2 screen px: a sub-pixel orbit landing on the parent.
    const placement = resolveVesselMarkerPlacement({ x: 2, y: 0 }, 1);
    // Offset stays on the same ray from the parent (positive x, y ~ 0).
    expect(placement.marker.x).toBeGreaterThan(2);
    expect(placement.marker.y).toBeCloseTo(0, 6);
    // A leader line is drawn from the TRUE position to the offset marker.
    expect(placement.leaderFrom).toEqual({ x: 2, y: 0 });
  });

  it("pushes the marker to at least the crowd threshold in screen px", () => {
    const zoom = 3;
    const placement = resolveVesselMarkerPlacement({ x: 1, y: 1 }, zoom);
    const screenDist =
      Math.hypot(placement.marker.x, placement.marker.y) * zoom;
    expect(screenDist).toBeGreaterThanOrEqual(MARKER_CROWD_THRESHOLD_PX);
  });

  it("picks a stable fallback direction when the vessel sits exactly on the parent", () => {
    const placement = resolveVesselMarkerPlacement({ x: 0, y: 0 }, 1);
    expect(placement.leaderFrom).toEqual({ x: 0, y: 0 });
    expect(Math.hypot(placement.marker.x, placement.marker.y)).toBeGreaterThan(
      0,
    );
  });

  it("keeps the offset a consistent SCREEN distance regardless of zoom", () => {
    const near = resolveVesselMarkerPlacement({ x: 1, y: 0 }, 1);
    const nearZoomedIn = resolveVesselMarkerPlacement({ x: 1, y: 0 }, 10);
    const screenDistAt1 = Math.hypot(near.marker.x, near.marker.y) * 1;
    const screenDistAt10 =
      Math.hypot(nearZoomedIn.marker.x, nearZoomedIn.marker.y) * 10;
    expect(screenDistAt1).toBeCloseTo(screenDistAt10, 6);
  });
});
