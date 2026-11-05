import { describe, expect, it } from "vitest";
import { deriveDockAngles } from "../shared/dockAngles";
import replay from "./__replays__/reticle-replay.json";
import { reticleOffset, reticleTravelPx } from "./reticleGeometry";

const MAX_DEG = 8;
const RAD = Math.PI / 180;

interface Row {
  distance: number;
  forwardDot: number;
  worldRelativePosition: { x: number; y: number; z: number };
}

/** Where the reticle lands, in px from the frame centre, for a port-frame separation. */
function reticleAt(
  position: { x: number; y: number; z: number },
  frame: { width: number; height: number },
  picture: { aspect: number; verticalFovDeg: number },
) {
  const { ax, ay } = deriveDockAngles(position);
  const travel = reticleTravelPx(frame, picture, MAX_DEG);
  return {
    x: reticleOffset(ax, MAX_DEG, picture) * travel,
    y: -reticleOffset(ay, MAX_DEG, picture) * travel,
  };
}

/** The camera maths on its own: a pinhole of vertical field `fov`, cropped by cover into `box`. */
function pinholePx(
  dir: { x: number; y: number; z: number },
  render: { w: number; h: number },
  fov: number,
  box: { w: number; h: number },
) {
  const f = render.h / 2 / Math.tan((fov * RAD) / 2);
  const s = Math.max(box.w / render.w, box.h / render.h);
  return { x: s * f * (dir.x / dir.z), y: -s * f * (dir.y / dir.z) };
}

describe("recorded run: the target port sits on the camera crosshair", () => {
  const { camera, frame, rows } = replay;
  const picture = {
    aspect: camera.renderWidth / camera.renderHeight,
    verticalFovDeg: camera.verticalFovDeg,
  };

  it.each(
    rows as Row[],
  )("lands the reticle on the crosshair at $distance m", (row) => {
    // The craft were aimed at the target port, so in the own port's axes the separation is dead ahead.
    const portFrame = { x: 0, y: 0, z: row.distance };
    const at = reticleAt(portFrame, frame, picture);
    expect(Math.abs(at.x)).toBeLessThan(3);
    expect(Math.abs(at.y)).toBeLessThan(3);
  });

  it("reads head-on ports as aligned, which the recorded dot product says they were", () => {
    for (const row of rows as Row[]) expect(row.forwardDot).toBeLessThan(-0.98);
  });

  it("is what put the old reticle 245 px out: the scene-axes separation read as a port frame", () => {
    const row = (rows as Row[])[0];
    const at = reticleAt(row.worldRelativePosition, frame, picture);
    expect(Math.abs(at.x)).toBeGreaterThan(100);
  });
});

describe("off-axis targets land where the camera draws them", () => {
  const cases = [
    {
      name: "16:9 render in a 16:9 box",
      render: { w: 1024, h: 576 },
      box: { w: 800, h: 450 },
    },
    {
      name: "the run's 1024x400 render in its 1568x392 frame",
      render: { w: 1024, h: 400 },
      box: { w: 1568, h: 392 },
    },
    {
      name: "a 16:9 render cropped by a tall frame",
      render: { w: 1024, h: 576 },
      box: { w: 300, h: 500 },
    },
  ];

  it.each(cases)("$name", ({ render, box }) => {
    const fov = 60;
    const target = { x: 3.1, y: -1.7, z: 24 };
    const picture = { aspect: render.w / render.h, verticalFovDeg: fov };
    const frame = { width: box.w, height: box.h };
    const expected = pinholePx(target, render, fov, box);
    const at = reticleAt(target, frame, picture);
    expect(at.x).toBeCloseTo(expected.x, 6);
    expect(at.y).toBeCloseTo(expected.y, 6);
  });
});
