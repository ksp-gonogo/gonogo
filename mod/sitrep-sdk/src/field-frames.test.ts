import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { frameOf } from "./field-frames";

describe("frameOf", () => {
  it("resolves a part-local field nested under a list of parts", () => {
    expect(frameOf("vessel.parts", "parts.bounds.center")?.frame).toBe(
      "part-local",
    );
    expect(frameOf("vessel.parts", "parts.bounds.size")?.frame).toBe(
      "part-local",
    );
  });

  it("resolves the vessel-local position of the part itself, distinct from its bounds", () => {
    expect(frameOf("vessel.parts", "parts.position")?.frame).toBe(
      "vessel-local",
    );
  });

  it("resolves a framed vector's components to the vector's frame", () => {
    expect(frameOf("vessel.parts", "parts.position.x")?.frame).toBe(
      "vessel-local",
    );
  });

  it("carries the per-tick switch of a frame that changes with the body's rotation", () => {
    expect(frameOf("vessel.orbit.truth", "position")).toEqual({
      frame: "body-centred-inertial",
      whenSet: "body-centred-rotating",
      selectedBy: "frameRotating",
    });
  });

  it("reports none for a field that declares no frame", () => {
    expect(frameOf("vessel.parts", "parts.title")).toBeUndefined();
    expect(frameOf("vessel.parts", "parts.bounds")).toBeUndefined();
    expect(frameOf("vessel.parts", "nope.nothing")).toBeUndefined();
  });
});

describe("generated frames.ts", () => {
  it("is emitted in step with the contract", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./__generated__/frames.ts", import.meta.url)),
      "utf8",
    );
    expect(src).toMatch(/export const GENERATED_TOPIC_FRAMES/);
    expect(src).toMatch(/export const GENERATED_TYPE_FRAMES/);
  });
});
