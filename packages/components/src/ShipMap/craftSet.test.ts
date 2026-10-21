import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KspPartCategory } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { CRAFT_SET, type CraftWire, craftParts } from "./craftSet";
import { CLUSTER_GAP_PX, findDenseClusters } from "./denseCluster";
import { renderShipMapToSvg } from "./render";
import {
  computeShipBaseScale,
  drawnHalfExtent,
  paintOrder,
  project,
} from "./shipLayout";

/*
 * Stock craft captured in the game: the wire frame of each (`vessel.parts`,
 * trimmed to the fields the Ship Map reads) next to a side screenshot. Every
 * rule here holds on all of them, with nothing tuned for one.
 */
function wireOf(name: string): CraftWire {
  return JSON.parse(
    readFileSync(
      join(__dirname, "__fixtures__", "craftset", `${name}.json`),
      "utf8",
    ),
  );
}

describe.each(CRAFT_SET)("captured craft %s", (name) => {
  const wire = wireOf(name);
  const parts = craftParts(wire);
  const { projected, bounds } = project(parts);
  const categoryOf = new Map(wire.parts.map((p) => [Number(p.id), p]));

  it("draws a wing only where the part is an aerodynamic one", () => {
    const wings = parts.filter((p) => p.type === "fin");
    for (const wing of wings) {
      const source = categoryOf.get(wing.flightId);
      expect(source?.categoryOrdinal, wing.name).toBe(KspPartCategory.Aero);
    }
  });

  it("draws a part carrying body lift as the box it is", () => {
    const bodyLift = wire.parts.filter(
      (p) =>
        p.modules.includes("ModuleLiftingSurface") &&
        p.categoryOrdinal !== KspPartCategory.Aero,
    );
    for (const source of bodyLift) {
      const drawn = parts.find((p) => p.flightId === Number(source.id));
      expect(drawn?.type, source.name).not.toBe("fin");
    }
  });

  it("draws a launch clamp as an outline and fits the view to the craft without it", () => {
    const clamps = parts.filter((p) => p.name.startsWith("launchClamp"));
    for (const clamp of clamps) expect(clamp.type).toBe("clamp");
    if (clamps.length === 0) return;
    const rest = projected.filter((p) => p.type !== "clamp");
    const low = Math.min(
      ...rest.map((p) => p.axial - drawnHalfExtent(p).axial),
    );
    const high = Math.max(
      ...rest.map((p) => p.axial + drawnHalfExtent(p).axial),
    );
    expect(bounds.h).toBeCloseTo(high - low, 6);
  });

  it("keeps a launch clamp out of every dense cluster", () => {
    const scale = computeShipBaseScale(bounds, 640, 800);
    const clusters = findDenseClusters(projected, CLUSTER_GAP_PX / scale);
    for (const cluster of clusters) {
      for (const member of cluster.members) {
        expect(member.type, member.name).not.toBe("clamp");
      }
    }
  });

  it("fits every corner of every drawn box inside the view bounds", () => {
    const left = bounds.cx - bounds.w / 2;
    const right = bounds.cx + bounds.w / 2;
    const bottom = bounds.cy - bounds.h / 2;
    const top = bounds.cy + bounds.h / 2;
    const slack = 1e-6;
    for (const p of projected) {
      if (p.type === "clamp") continue;
      for (const [sx, sy] of [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ]) {
        const u = sx * p.latHalfExtent;
        const v = sy * p.axialHalfExtent;
        const lat =
          p.lat + u * Math.cos(p.rotationRad) + v * Math.sin(p.rotationRad);
        const axial =
          p.axial - u * Math.sin(p.rotationRad) + v * Math.cos(p.rotationRad);
        expect(lat, p.name).toBeGreaterThanOrEqual(left - slack);
        expect(lat, p.name).toBeLessThanOrEqual(right + slack);
        expect(axial, p.name).toBeGreaterThanOrEqual(bottom - slack);
        expect(axial, p.name).toBeLessThanOrEqual(top + slack);
      }
    }
  });

  it("draws landing legs and gear as a strut and every other wheel as a disc", () => {
    for (const source of wire.parts) {
      const drawn = parts.find((p) => p.flightId === Number(source.id));
      if (!source.modules.includes("ModuleWheelBase")) continue;
      const folds = source.modules.includes("ModuleWheelDeployment");
      expect(drawn?.type, source.name).toBe(folds ? "gear" : "wheel");
    }
  });

  it("paints a fairing after every part it covers", () => {
    const order = paintOrder(projected);
    const fairing = order.findIndex((p) => p.type === "fairing");
    if (fairing === -1) return;
    expect(fairing).toBe(order.length - 1);
  });
});

describe.each([
  "learstar-orbiter",
  "learstar-a1",
])("captured plane %s wings", (name) => {
  const wings = project(craftParts(wireOf(name))).projected.filter(
    (p) => p.type === "fin" && p.tipSign != null,
  );

  it("points every wing's tip away from the spine and its leading edge toward the nose", () => {
    for (const wing of wings) {
      const tipLat = (wing.tipSign ?? 1) * Math.cos(wing.rotationRad);
      const leadAxial = Math.cos(wing.rotationRad);
      expect(leadAxial, wing.name).toBeGreaterThanOrEqual(-1e-9);
      if (
        Math.abs(wing.lat) > 0.5 &&
        Math.abs(Math.cos(wing.rotationRad)) > 0.1
      ) {
        expect(Math.sign(tipLat), `${wing.name} at ${wing.lat}`).toBe(
          Math.sign(wing.lat),
        );
      }
    }
  });

  it("draws a mirrored pair of wings as mirror images", () => {
    for (const wing of wings.filter((w) => w.lat < -0.5)) {
      const twin = wings.find(
        (o) =>
          o.name === wing.name &&
          Math.abs(o.lat + wing.lat) < 0.05 &&
          Math.abs(o.axial - wing.axial) < 0.05,
      );
      if (!twin) continue;
      expect(twin.rotationRad, wing.name).toBeCloseTo(-wing.rotationRad, 2);
      expect(twin.tipSign, wing.name).toBe(-(wing.tipSign ?? 1));
      expect(twin.latHalfExtent, wing.name).toBeCloseTo(wing.latHalfExtent, 2);
    }
  });
});

describe("captured plane Learstar", () => {
  it("draws the small wing parts along the main wing's sweep", () => {
    const { projected } = project(craftParts(wireOf("learstar-orbiter")));
    const main = projected.filter((p) => p.name === "sweptWing2");
    const elevons = projected.filter((p) => p.name === "elevon5");
    expect(main).toHaveLength(2);
    expect(elevons).toHaveLength(4);
    for (const piece of [...main, ...elevons]) {
      // Every one of them has its leading edge facing the nose and its tip outboard.
      expect(Math.cos(piece.rotationRad), piece.name).toBeGreaterThan(0);
      expect(
        Math.sign((piece.tipSign ?? 0) * Math.cos(piece.rotationRad)),
        piece.name,
      ).toBe(Math.sign(piece.lat));
    }
  });
});

describe("captured craft with a closed fairing", () => {
  it("classifies the fairing as a shell and paints it over the payload", () => {
    const { projected } = project(craftParts(wireOf("comsat-lx-fairing")));
    const shells = projected.filter((p) => p.type === "fairing");
    expect(shells.map((p) => p.name)).toEqual(["fairingSize1"]);
  });
});

describe("captured craft cargo bays", () => {
  const bayRoles = (name: string) =>
    (
      renderShipMapToSvg(craftParts(wireOf(name))).match(
        /data-role="cargo-bay-open"/g,
      ) ?? []
    ).length;

  it("draws each open bay as a hollow hold and a closed bay as a plain box", () => {
    expect(bayRoles("learstar-orbiter-bays-open")).toBe(3);
    expect(bayRoles("learstar-orbiter")).toBe(0);
    expect(bayRoles("learstar-orbiter-gear-down")).toBe(0);
  });
});

describe("captured craft deploy states", () => {
  it("draws the station panels wider once they extend", () => {
    const widthOf = (name: string) =>
      project(craftParts(wireOf(name))).bounds.w;
    expect(widthOf("station-core-panels-extended")).toBeGreaterThan(
      widthOf("station-core") * 3,
    );
  });

  it("draws a foot only on gear that is down, and folded gear as an outline", () => {
    const feet = (name: string) =>
      (
        renderShipMapToSvg(craftParts(wireOf(name))).match(
          /data-role="gear-foot"/g,
        ) ?? []
      ).length;
    expect(feet("learstar-orbiter")).toBe(0);
    expect(feet("learstar-orbiter-gear-down")).toBe(3);
  });
});

describe("captured two-stage lander", () => {
  const svg = renderShipMapToSvg(craftParts(wireOf("two-stage-lander")));
  const count = (pattern: RegExp) => (svg.match(pattern) ?? []).length;

  it("draws each of its four extended legs as a strut with a foot and no stray mark beside it", () => {
    expect(count(/data-role="gear-foot"/g)).toBe(4);
    expect(count(/data-role="gear-stand"/g)).toBe(0);
  });
});
