import { getComponents } from "@ksp-gonogo/core";
import { beforeAll, describe, expect, it } from "vitest";
import { gateTopicsOf } from "./RequiresGuard";

/*
 * Which built-in widgets the gate holds behind "No active vessel" or the career
 * notice, read off what each declares it reads. Listed in full, so a widget
 * joining or leaving either gate shows as a diff.
 */
describe("the built-in catalogue, gated by the Topics it reads", () => {
  let vessel: string[] = [];
  let career: string[] = [];

  beforeAll(async () => {
    await import("../index");
    for (const def of getComponents()) {
      const gate = gateTopicsOf({
        channels: def.channels,
        optionalChannels: def.optionalChannels,
        dataRequirements: def.dataRequirements?.map(String),
        configChannels: def.channelsFromConfig?.(def.defaultConfig ?? {}),
      });
      if (gate.vesselTopics.length > 0 || def.channelsFromConfig) {
        vessel.push(def.id);
      }
      if (gate.careerTopics.length > 0) career.push(def.id);
    }
    vessel = vessel.sort();
    career = career.sort();
  });

  it("holds every vessel widget behind 'No active vessel', and nothing that works at the Space Center", () => {
    expect(vessel).toMatchInlineSnapshot(`
      [
        "action-group",
        "atmosphere-profile",
        "comm-signal",
        "crew-status",
        "escape-profile",
        "experiments",
        "flight-plan",
        "fuel-status",
        "graph",
        "ground-track",
        "kepler-period",
        "landing-status",
        "maneuver-planner",
        "navball",
        "orbit-view",
        "orbital-ascent",
        "power-systems",
        "rendezvous",
        "resource-ops",
        "semi-major-axis",
        "target-picker",
        "thermal-status",
        "transfer-window",
        "twr",
        "vessel-schematic",
      ]
    `);
  });

  it("holds the career-only widgets behind the career notice", () => {
    expect(career).toMatchInlineSnapshot(`
      [
        "administration-building",
        "contract-manager",
        "research-and-development",
      ]
    `);
  });

  it("leaves the Space Center's own widgets open with no vessel", () => {
    for (const id of [
      "tracking-station",
      "warp-control",
      "launch-director",
      "science-data",
      "vessel-catalog",
      "astronaut-complex",
    ]) {
      expect(vessel).not.toContain(id);
      expect(career).not.toContain(id);
    }
  });
});
