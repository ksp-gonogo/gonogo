import {
  Situation,
  type SystemBodies,
  type SystemVessels,
  wrapTopicPayload,
} from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import scene from "./__playground__/same-named-craft.json";
import { computeVesselOrbitEntities } from "./vesselOrbitsContribution";

const emit = (channel: string) =>
  structuredClone(
    scene._stream.emits.find((e) => e.channel === channel)?.value,
  );

/** The scene's wire values, wrapped as a reader sees them. */
const bodies = wrapTopicPayload<SystemBodies>(
  "system.bodies",
  emit("system.bodies") as never,
);
const roster = wrapTopicPayload<SystemVessels>(
  "system.vessels",
  emit("system.vessels") as never,
);
const sallyHuts = roster.vessels.filter((v) => v.name === "Sally-Hut 1");

function entities() {
  return computeVesselOrbitEntities(roster, bodies);
}

describe("five craft that share a name", () => {
  it("is the scene the report came from: five of one name, one in orbit and four on the ground", () => {
    expect(sallyHuts).toHaveLength(5);
    expect(
      sallyHuts.filter((v) => v.situation === Situation.Orbiting),
    ).toHaveLength(1);
  });

  it("names each craft by where it is, so the five read as five", () => {
    const names = entities()
      .filter((e) => e.vesselId !== "Tester")
      .map((e) => e.meta?.name);
    expect(new Set(names).size).toBe(5);
    expect(names).toEqual(
      expect.arrayContaining([
        "Sally-Hut 1 · Orbiting",
        "Sally-Hut 1 · Launch Pad",
        "Sally-Hut 1 · Runway",
        "Sally-Hut 1 · Woomerang Launch Site",
        "Sally-Hut 1 · Desert Launch Site",
      ]),
    );
  });

  it("leaves a name nobody else carries as it is", () => {
    const tester = entities().find((e) => e.vesselId === "Tester");
    expect(tester?.meta?.name).toBe("Tester");
  });

  it("gives a craft on the ground a Site and a Position row", () => {
    const runway = entities().find((e) => e.meta?.site === "Runway");
    expect(runway?.meta?.position).toBe("0.05°S 74.72°W");
    expect(runway?.meta?.situation).toBe("Landed");
  });

  it("gives a craft in orbit neither", () => {
    const orbiting = entities().find(
      (e) => e.meta?.situation === "Orbiting" && e.vesselId !== "Tester",
    );
    expect(orbiting?.meta).not.toHaveProperty("site");
    expect(orbiting?.meta).not.toHaveProperty("position");
  });

  it("draws a craft on the ground as a mark at its body and never as the ellipse through the planet", () => {
    const ground = entities().filter((e) => e.meta?.site !== undefined);
    expect(ground).toHaveLength(4);
    for (const e of ground) {
      expect(e.shape.kind).toBe("point");
      expect(e.position).toMatchObject({
        kind: "fixed",
        parentName: "Kerbin",
        xMetres: 0,
        yMetres: 0,
        zMetres: 0,
      });
    }
  });

  it("still draws the craft in orbit as a ring", () => {
    const orbiting = entities().find(
      (e) => e.meta?.situation === "Orbiting" && e.vesselId !== "Tester",
    );
    expect(orbiting?.shape.kind).toBe("orbit-path");
  });
});
