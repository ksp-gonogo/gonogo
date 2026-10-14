import { describe, expect, it } from "vitest";
import { viewedGeometry } from "./overlayGeometry";
import type { SystemEntitiesContext } from "./systemEntities";
import { projectEntityPosition } from "./systemEntities";

const CTX: SystemEntitiesContext = {
  parentName: "Kerbin",
  width: 400,
  height: 300,
  plotScale: 1e-5,
  center: { x: 0, y: 0 },
};

describe("viewedGeometry", () => {
  it("is the auto-fit context at rest", () => {
    expect(viewedGeometry(CTX, 1, { x: 0, y: 0 })).toEqual(CTX);
  });

  it("puts a point where the diagram's zoomed viewBox draws it", () => {
    const zoom = 2;
    const pan = { x: 10, y: -4 };
    const viewed = viewedGeometry(CTX, zoom, pan);
    const at = projectEntityPosition(
      {
        kind: "fixed",
        parentName: "Kerbin",
        xMetres: 3e6,
        yMetres: 1e6,
        zMetres: 0,
      },
      viewed as SystemEntitiesContext,
    );
    /* The diagram's viewBox is centred on the pan and spans 1/zoom of the frame, so a user-unit point p lands at (p - pan) * zoom in the unzoomed frame. */
    const p = { x: 3e6 * CTX.plotScale, y: 1e6 * CTX.plotScale };
    expect(at?.x).toBeCloseTo((p.x - pan.x) * zoom, 6);
    expect(at?.y).toBeCloseTo((p.y - pan.y) * zoom, 6);
  });

  it("passes a missing frame through", () => {
    expect(viewedGeometry(null, 3, { x: 1, y: 1 })).toBeNull();
  });
});
