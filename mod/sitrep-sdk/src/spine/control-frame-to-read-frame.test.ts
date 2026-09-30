import { describe, expect, it } from "vitest";
import {
  type BodyEntry,
  type ControlFrame,
  ControlFrameKind,
} from "../__generated__/contract";
import { deriveCelestialFacts } from "./celestial-facts";
import {
  controlFrameToReadFrameChoice,
  readFrameChoicesEqual,
} from "./control-frame-to-read-frame";

function value(magnitude: number) {
  return { magnitude } as BodyEntry["gravParameter"];
}

function entry(index: number, name: string, parentIndex?: number): BodyEntry {
  return {
    index,
    name,
    parentIndex,
    gravParameter: value(1e12),
  } as BodyEntry;
}

const FACTS = deriveCelestialFacts(
  [entry(0, "Kerbol"), entry(1, "Kerbin", 0), entry(2, "Mun", 1)],
  0,
);

function frame(overrides: Partial<ControlFrame>): ControlFrame {
  return { kind: ControlFrameKind.Unspecified, ...overrides };
}

describe("controlFrameToReadFrameChoice", () => {
  it("maps BodyCentredInertial to a body-centred-inertial choice by index", () => {
    expect(
      controlFrameToReadFrameChoice(
        frame({
          kind: ControlFrameKind.BodyCentredInertial,
          centreBody: "Kerbin",
        }),
        FACTS,
      ),
    ).toEqual({ kind: "body-centred-inertial", bodyIndex: 1 });
  });

  it("maps BodyCentredBodyDirection to a parent-direction choice", () => {
    expect(
      controlFrameToReadFrameChoice(
        frame({
          kind: ControlFrameKind.BodyCentredBodyDirection,
          centreBody: "Kerbin",
        }),
        FACTS,
      ),
    ).toEqual({ kind: "parent-direction", bodyIndex: 1 });
  });

  it("maps RotatingPulsating to a rotating-pulsating choice keyed by the secondary body", () => {
    expect(
      controlFrameToReadFrameChoice(
        frame({
          kind: ControlFrameKind.RotatingPulsating,
          primaryBody: "Kerbin",
          secondaryBody: "Mun",
        }),
        FACTS,
      ),
    ).toEqual({ kind: "rotating-pulsating", bodyIndex: 2 });
  });

  it("has no read-frame equivalent for Unspecified", () => {
    expect(
      controlFrameToReadFrameChoice(
        frame({ kind: ControlFrameKind.Unspecified }),
        FACTS,
      ),
    ).toBeNull();
  });

  it("has no read-frame equivalent for BarycentricRotating", () => {
    expect(
      controlFrameToReadFrameChoice(
        frame({
          kind: ControlFrameKind.BarycentricRotating,
          primaryBody: "Kerbin",
          secondaryBody: "Mun",
        }),
        FACTS,
      ),
    ).toBeNull();
  });

  it("has no read-frame equivalent for BodySurface", () => {
    expect(
      controlFrameToReadFrameChoice(
        frame({ kind: ControlFrameKind.BodySurface, centreBody: "Kerbin" }),
        FACTS,
      ),
    ).toBeNull();
  });

  it("is null for a target-relative frame regardless of kind", () => {
    expect(
      controlFrameToReadFrameChoice(
        frame({
          kind: ControlFrameKind.BodyCentredInertial,
          centreBody: "Kerbin",
          targetFrameSelected: true,
        }),
        FACTS,
      ),
    ).toBeNull();
  });

  it("is null with no frame mounted", () => {
    expect(controlFrameToReadFrameChoice(null, FACTS)).toBeNull();
    expect(controlFrameToReadFrameChoice(undefined, FACTS)).toBeNull();
  });

  it("is null with no catalogue yet", () => {
    expect(
      controlFrameToReadFrameChoice(
        frame({
          kind: ControlFrameKind.BodyCentredInertial,
          centreBody: "Kerbin",
        }),
        undefined,
      ),
    ).toBeNull();
  });

  it("is null when the named body is not (yet) in the catalogue", () => {
    expect(
      controlFrameToReadFrameChoice(
        frame({
          kind: ControlFrameKind.BodyCentredInertial,
          centreBody: "Duna",
        }),
        FACTS,
      ),
    ).toBeNull();
  });
});

describe("readFrameChoicesEqual", () => {
  it("is true for the same kind and body", () => {
    expect(
      readFrameChoicesEqual(
        { kind: "body-centred-inertial", bodyIndex: 1 },
        { kind: "body-centred-inertial", bodyIndex: 1 },
      ),
    ).toBe(true);
  });

  it("is false for a different kind", () => {
    expect(
      readFrameChoicesEqual(
        { kind: "body-centred-inertial", bodyIndex: 1 },
        { kind: "parent-direction", bodyIndex: 1 },
      ),
    ).toBe(false);
  });

  it("is false for a different body", () => {
    expect(
      readFrameChoicesEqual(
        { kind: "body-centred-inertial", bodyIndex: 1 },
        { kind: "body-centred-inertial", bodyIndex: 2 },
      ),
    ).toBe(false);
  });

  it("treats an absent bodyIndex as null, not as unequal to it", () => {
    expect(
      readFrameChoicesEqual(
        { kind: "follow-control-frame" },
        { kind: "follow-control-frame", bodyIndex: null },
      ),
    ).toBe(true);
  });

  it("is true for null against null and false against a real choice", () => {
    expect(readFrameChoicesEqual(null, null)).toBe(true);
    expect(
      readFrameChoicesEqual(null, {
        kind: "body-centred-inertial",
        bodyIndex: 1,
      }),
    ).toBe(false);
  });
});
