import type { LibrationPair } from "@ksp-gonogo/sitrep-client";
import { ControlFrameKind } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { autoPair, controlFramePair } from "./pairResolution";

const CANDIDATES: readonly LibrationPair[] = [
  {
    secondaryIndex: 1,
    secondaryName: "Kerbin",
    primaryIndex: 0,
    primaryName: "Kerbol",
  },
  {
    secondaryIndex: 2,
    secondaryName: "Mun",
    primaryIndex: 1,
    primaryName: "Kerbin",
  },
  {
    secondaryIndex: 3,
    secondaryName: "Minmus",
    primaryIndex: 1,
    primaryName: "Kerbin",
  },
];

describe("controlFramePair", () => {
  it("follows a rotating-pulsating frame turning with a catalogue pair", () => {
    expect(
      controlFramePair(
        {
          kind: ControlFrameKind.RotatingPulsating,
          primaryBody: "Kerbin",
          secondaryBody: "Mun",
        },
        CANDIDATES,
      ),
    ).toBe(2);
  });

  it("follows a barycentric rotating frame the same way", () => {
    expect(
      controlFramePair(
        {
          kind: ControlFrameKind.BarycentricRotating,
          primaryBody: "Kerbin",
          secondaryBody: "Minmus",
        },
        CANDIDATES,
      ),
    ).toBe(3);
  });

  it("names no pair for two bodies that are not parent and child", () => {
    expect(
      controlFramePair(
        {
          kind: ControlFrameKind.RotatingPulsating,
          primaryBody: "Kerbol",
          secondaryBody: "Mun",
        },
        CANDIDATES,
      ),
    ).toBeNull();
  });

  it("names no pair for a centred frame, the target frame or no frame", () => {
    expect(
      controlFramePair(
        { kind: ControlFrameKind.BodyCentredInertial, centreBody: "Kerbin" },
        CANDIDATES,
      ),
    ).toBeNull();
    expect(
      controlFramePair(
        { kind: ControlFrameKind.Unspecified, targetFrameSelected: true },
        CANDIDATES,
      ),
    ).toBeNull();
    expect(controlFramePair(undefined, CANDIDATES)).toBeNull();
  });
});

describe("autoPair with a Control Frame", () => {
  it("returns the Control Frame's pair ahead of the craft's own body", () => {
    expect(
      autoPair(undefined, CANDIDATES, 0, null, null, 1, {
        kind: ControlFrameKind.RotatingPulsating,
        primaryBody: "Kerbin",
        secondaryBody: "Minmus",
      }),
    ).toBe(3);
  });

  it("falls through to the craft's own body when the frame's pair is not a candidate", () => {
    expect(
      autoPair(undefined, CANDIDATES, 0, null, null, 1, {
        kind: ControlFrameKind.RotatingPulsating,
        primaryBody: "Kerbol",
        secondaryBody: "Mun",
      }),
    ).toBe(1);
  });
});
