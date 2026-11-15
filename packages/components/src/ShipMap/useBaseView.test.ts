import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deriveTopologyFromVesselParts } from "@ksp-gonogo/data";
import type { VesselParts } from "@ksp-gonogo/sitrep-sdk";
import { wrapTopicPayload } from "@ksp-gonogo/sitrep-sdk";
import { renderHook } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import type { CraftWire } from "./craftSet";
import { pickView } from "./shipView";
import { useBaseView } from "./useBaseView";

type TurnableWire = CraftWire & {
  parts: {
    position: { x: number; y: number; z: number };
    up: { x: number; y: number; z: number };
    forward: { x: number; y: number; z: number };
  }[];
};

function topologyOf(wire: CraftWire, turnedBy = 0) {
  const c = Math.cos(turnedBy);
  const s = Math.sin(turnedBy);
  const turn = (v: { x: number; y: number; z: number }) => ({
    x: v.x * c + v.z * s,
    y: v.y,
    z: -v.x * s + v.z * c,
  });
  const copy = structuredClone(wire) as TurnableWire;
  for (const p of copy.parts) {
    p.position = turn(p.position);
    p.up = turn(p.up);
    p.forward = turn(p.forward);
  }
  return deriveTopologyFromVesselParts(
    wrapTopicPayload<VesselParts>("vessel.parts", copy as never),
  );
}

function wireOf(name: string): CraftWire {
  return JSON.parse(
    readFileSync(
      join(__dirname, "__fixtures__", "craftset", `${name}.json`),
      "utf8",
    ),
  );
}

describe("useBaseView", () => {
  const wire = wireOf("seahawk-gear-up");
  const first = topologyOf(wire);
  // The same craft after its symmetry has changed, which is what staging does.
  const changed = topologyOf(wire, Math.PI / 3);

  it("starts from a pair of topologies that would pick different views", () => {
    expect(pickView(changed.parts)).not.toBe(pickView(first.parts));
    expect(changed.rootFlightId).toBe(first.rootFlightId);
  });

  it("keeps the default while the same craft's parts change", () => {
    const { result, rerender } = renderHook(({ t }) => useBaseView(t), {
      initialProps: { t: first },
    });
    const chosen = result.current;

    rerender({ t: changed });

    expect(chosen).toBe(pickView(first.parts));
    expect(result.current).toBe(chosen);
  });

  it("finds a new default for a different craft", () => {
    const other = topologyOf(wireOf("kerbal-x"));
    const { result, rerender } = renderHook(({ t }) => useBaseView(t), {
      initialProps: { t: first },
    });

    rerender({ t: other });

    expect(result.current).toBe(pickView(other.parts));
  });
});
