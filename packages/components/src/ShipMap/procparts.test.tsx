import type { TopologyPart } from "@ksp-gonogo/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import wireHulls from "./__fixtures__/procparts-wire-hulls.json";
import { renderPartShape } from "./partShape";
import { buildShipMapPart } from "./shipTopology";

/**
 * Parts recorded from the game with ProceduralParts and ProceduralFairings
 * installed, one hull per part as the wire carried it.
 */
function recordedPart(label: string): TopologyPart {
  const found = wireHulls.find((p) => p.label === label);
  if (!found) throw new Error(`no recorded part ${label}`);
  const [ox, oy, oz] = found.orgPos;
  const [ux, uy, uz] = found.up;
  const [fx, fy, fz] = found.forward;
  return {
    flightId: 1,
    persistentId: 1,
    parentFlightId: null,
    name: found.name,
    title: found.name,
    manufacturer: "",
    category: "Payload",
    inverseStage: -1,
    crewCapacity: 0,
    maxTemp: 1200,
    crashTolerance: 8,
    dryMass: 0.1,
    orgPos: [ox, oy, oz],
    up: [ux, uy, uz],
    forward: [fx, fy, fz],
    bounds: found.bounds,
    modules: found.modules,
  };
}

const PX_PER_METRE = 100;

/** The points of every polygon the part's outline renders to, in metres from the box centre with y up. */
function drawnOutline(label: string): { x: number; y: number }[][] {
  const built = buildShipMapPart(recordedPart(label), undefined, undefined, 0);
  const silhouette = (built.silhouette ?? []).map((outline) =>
    outline.map((q) => ({ x: q.x * PX_PER_METRE, y: -q.y * PX_PER_METRE })),
  );
  const markup = renderToStaticMarkup(
    renderPartShape(
      built.type,
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 0, y: 0 },
      "var(--color-text-muted)",
      false,
      1,
      1,
      undefined,
      true,
      { silhouette },
    ),
  );
  return [
    ...markup.matchAll(
      /<polygon data-role="mesh-outline"[^>]*points="([^"]+)"/g,
    ),
  ].map((m) =>
    m[1].split(" ").map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x: x / PX_PER_METRE, y: -y / PX_PER_METRE };
    }),
  );
}

/** The width of an outline at a height, by crossing its edges. */
function widthAt(outline: { x: number; y: number }[], y: number): number {
  const xs: number[] = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) {
      xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
  }
  return xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
}

describe("a closed fairing side recorded in the game", () => {
  const [outline] = drawnOutline("fairing side, closed");

  it("is drawn as one outline from its hull", () => {
    expect(drawnOutline("fairing side, closed")).toHaveLength(1);
  });

  it("tapers to the top as the hull does, 0.42 m wide there against 0.78 m at the base", () => {
    expect(widthAt(outline, 0.31 - 1.3)).toBeCloseTo(0.78, 1);
    expect(widthAt(outline, 2.29 - 1.3)).toBeCloseTo(0.42, 1);
  });
});

describe("a fairing base recorded in the game", () => {
  it("is drawn from its hull and not as a rounded rectangle", () => {
    const [outline] = drawnOutline("fairing base");
    const xs = outline.map((q) => q.x);
    expect(outline.length).toBeGreaterThan(4);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1.44, 1);
  });
});
