import type { Vec3Of } from "@ksp-gonogo/sitrep-sdk";
import { type Reading, value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  orbitFrameAxes as axesOf,
  drift,
  type OrbitComponents,
} from "./orbitFrame";

const components = (v: Vec3Of<"m"> | Vec3Of<"m/s">): OrbitComponents => ({
  radial: v.x.magnitude,
  alongTrack: v.y.magnitude,
  normal: v.z.magnitude,
});

function orbitFrameAxes(
  position: Reading<Vec3Of<"m">>,
  velocity: Reading<Vec3Of<"m/s">>,
) {
  return axesOf(
    position,
    velocity,
    position.value ? components(position.value) : undefined,
    velocity.value ? components(velocity.value) : undefined,
  );
}

function vec(unit: "m", x: number, y: number, z: number): Vec3Of<"m">;
function vec(unit: "m/s", x: number, y: number, z: number): Vec3Of<"m/s">;
function vec(unit: "m" | "m/s", x: number, y: number, z: number) {
  return unit === "m"
    ? { x: value("m", x), y: value("m", y), z: value("m", z) }
    : { x: value("m/s", x), y: value("m/s", y), z: value("m/s", z) };
}

function observed<T>(v: T): Reading<T> {
  return {
    state: "observed",
    value: v,
    atUt: value("ut", 10),
    reckoning: { status: "none" },
  } as Reading<T>;
}

const missing: Reading<Vec3Of<"m">> = {
  state: "absent",
  reckoning: { status: "none" },
} as Reading<Vec3Of<"m">>;
const missingRate: Reading<Vec3Of<"m/s">> = {
  state: "absent",
  reckoning: { status: "none" },
} as Reading<Vec3Of<"m/s">>;

describe("orbitFrameAxes", () => {
  it("names the side the target is on along each axis, and gives the offset unsigned", () => {
    const axes = orbitFrameAxes(
      observed(vec("m", 12, -399, 3)),
      observed(vec("m/s", 0, 0, 0)),
    );
    expect(axes?.map((a) => a.word)).toEqual(["Behind", "Above", "Left"]);
    expect(axes?.map((a) => a.offset.value?.magnitude)).toEqual([399, 12, 3]);
  });

  it("names the other side for the opposite sign", () => {
    const axes = orbitFrameAxes(
      observed(vec("m", -12, 399, -3)),
      observed(vec("m/s", 0, 0, 0)),
    );
    expect(axes?.map((a) => a.word)).toEqual(["Ahead", "Below", "Right"]);
  });

  it("reads closing as the offset shrinking, whichever side the target is on", () => {
    const axes = orbitFrameAxes(
      observed(vec("m", 10, 100, -50)),
      // Radial offset growing, along-track shrinking, normal offset shrinking toward zero.
      observed(vec("m/s", 0.4, -0.3, 0.2)),
    );
    const closing = Object.fromEntries(
      axes?.map((a) => [a.key, a.closing]) ?? [],
    );
    expect(closing.alongTrack).toBeCloseTo(0.3);
    expect(closing.radial).toBeCloseTo(-0.4);
    expect(closing.normal).toBeCloseTo(0.2);
    expect(axes?.map((a) => a.rate.value?.magnitude)).toEqual([0.3, 0.4, 0.2]);
  });

  it("gives no direction to an axis the target is level with", () => {
    const axes = orbitFrameAxes(
      observed(vec("m", 0.2, 50, 0)),
      observed(vec("m/s", 0.1, 0, 0.1)),
    );
    expect(axes?.find((a) => a.key === "radial")?.closing).toBeUndefined();
    expect(axes?.find((a) => a.key === "normal")?.closing).toBeUndefined();
  });

  it("carries nothing while the orbit-frame fields are absent", () => {
    expect(
      orbitFrameAxes(missing, observed(vec("m/s", 0, 0, 0))),
    ).toBeUndefined();
    expect(
      orbitFrameAxes(observed(vec("m", 0, 0, 0)), missingRate),
    ).toBeUndefined();
  });

  it("marks a held offset as held", () => {
    const held = {
      state: "held",
      value: vec("m", 0, 100, 0),
      asOfUt: value("ut", 5),
      grade: "held",
      reckoning: { status: "none" },
    } as Reading<Vec3Of<"m">>;
    const axes = orbitFrameAxes(held, observed(vec("m/s", 0, 0, 0)));
    expect(axes?.[0].offset.state).toBe("held");
  });
});

describe("drift", () => {
  it("is the target's motion negated, radial out and along-track forward", () => {
    const d = drift(
      observed(vec("m/s", 0.25, -4.7, 9)),
      observed(vec("m", 0, 1800, 0)),
    );
    expect(d).toEqual({ radial: -0.25, alongTrack: 4.7 });
  });

  it("is nothing for a held reading, which is not where the craft is moving now", () => {
    const held = {
      state: "held",
      value: vec("m/s", 1, 1, 1),
      asOfUt: value("ut", 5),
      grade: "held",
      reckoning: { status: "none" },
    } as Reading<Vec3Of<"m/s">>;
    expect(drift(held, observed(vec("m", 0, 100, 0)))).toBeUndefined();
  });
});
