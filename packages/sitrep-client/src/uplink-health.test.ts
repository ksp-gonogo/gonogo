import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import type { DerivedGet } from "./timeline-store";
import { deriveSystemUplinkHealth } from "./uplink-health";

interface RawUplinkHealth {
  state: number;
  detail: string | null;
  facts?: Array<{ label: string; value: string | null }>;
}

interface RawUplinkEntry {
  id: string;
  version: string;
  available: boolean;
  reason: string | null;
  health: RawUplinkHealth;
  ownedPrefixes?: string[];
}

interface RawSystemUplinksPayload {
  uplinks: RawUplinkEntry[];
}

function uplinksPoint(
  payload: RawSystemUplinksPayload | null,
): TimelinePoint<RawSystemUplinksPayload> {
  return {
    validAt: 0,
    payload,
    meta: makeMeta({ validAt: 0, quality: Quality.OnRails, source: "system" }),
    epoch: 0,
  };
}

function fakeGet(
  point: TimelinePoint<RawSystemUplinksPayload> | undefined,
): DerivedGet {
  return (<T>(topic: string) =>
    topic === "system.uplinks"
      ? (point as unknown as TimelinePoint<T> | undefined)
      : undefined) as DerivedGet;
}

describe("deriveSystemUplinkHealth: mod-side Uplink health self-report", () => {
  it("decodes a self-reported Degraded entry, deriving nothing from availability", () => {
    const raw: RawSystemUplinksPayload = {
      uplinks: [
        {
          id: "kos",
          version: "1.0.0",
          available: true,
          reason: null,
          health: { state: 1, detail: "no active CPU selected" },
        },
      ],
    };
    expect(deriveSystemUplinkHealth(fakeGet(uplinksPoint(raw)))).toEqual({
      uplinks: [
        {
          id: "kos",
          version: "1.0.0",
          available: true,
          reason: null,
          ownedPrefixes: [],
          health: {
            state: "degraded",
            detail: "no active CPU selected",
            facts: [],
          },
        },
      ],
    });
  });

  it("decodes an Unavailable entry carrying the registration-failure reason as detail", () => {
    const raw: RawSystemUplinksPayload = {
      uplinks: [
        {
          id: "broken",
          version: "1.0.0",
          available: false,
          reason: "registration threw: boom",
          health: { state: 2, detail: "registration threw: boom" },
        },
      ],
    };
    expect(deriveSystemUplinkHealth(fakeGet(uplinksPoint(raw)))).toEqual({
      uplinks: [
        {
          id: "broken",
          version: "1.0.0",
          available: false,
          reason: "registration threw: boom",
          ownedPrefixes: [],
          health: {
            state: "unavailable",
            detail: "registration threw: boom",
            facts: [],
          },
        },
      ],
    });
  });

  it("decodes a Healthy entry with no detail", () => {
    const raw: RawSystemUplinksPayload = {
      uplinks: [
        {
          id: "system",
          version: "1.0.0",
          available: true,
          reason: null,
          health: { state: 0, detail: null },
        },
      ],
    };
    expect(deriveSystemUplinkHealth(fakeGet(uplinksPoint(raw)))).toEqual({
      uplinks: [
        {
          id: "system",
          version: "1.0.0",
          available: true,
          reason: null,
          ownedPrefixes: [],
          health: { state: "healthy", detail: null, facts: [] },
        },
      ],
    });
  });

  it("decodes ownedPrefixes straight through: mod-side source of truth, no client re-derivation", () => {
    const raw: RawSystemUplinksPayload = {
      uplinks: [
        {
          id: "kos",
          version: "1.0.0",
          available: true,
          reason: null,
          ownedPrefixes: ["kos.terminal.", "kos.processors"],
          health: { state: 0, detail: null },
        },
      ],
    };
    expect(deriveSystemUplinkHealth(fakeGet(uplinksPoint(raw)))).toEqual({
      uplinks: [
        {
          id: "kos",
          version: "1.0.0",
          available: true,
          reason: null,
          ownedPrefixes: ["kos.terminal.", "kos.processors"],
          health: { state: "healthy", detail: null, facts: [] },
        },
      ],
    });
  });

  it("decodes the Uplink's own diagnostic facts in the order it wrote them", () => {
    // The identity of whatever an Uplink depends on: which file, which build,
    // which hash. Order is the Uplink author's and is preserved rather than
    // sorted, because it is how they meant the rows to read.
    const raw: RawSystemUplinksPayload = {
      uplinks: [
        {
          id: "example-uplink",
          version: "1.0.0",
          available: true,
          reason: null,
          health: {
            state: 1,
            detail: "This release has not been vetted here.",
            facts: [
              { label: "build", value: "/GameData/Example/native.so" },
              // An Uplink that knows a fact applies and has not established it
              // says null, which is not the same as a blank string: a client
              // renders "not known" rather than an empty row.
              { label: "release", value: null },
            ],
          },
        },
      ],
    };
    expect(
      deriveSystemUplinkHealth(fakeGet(uplinksPoint(raw)))?.uplinks[0]?.health
        .facts,
    ).toEqual([
      { label: "build", value: "/GameData/Example/native.so" },
      { label: "release", value: null },
    ]);
  });

  it("defaults facts to an empty array for a mod build that reports none (wire field absent)", () => {
    // Empty rather than absent, so a caller enumerates unconditionally instead
    // of testing for the key first.
    const raw = {
      uplinks: [
        {
          id: "legacy",
          version: "1.0.0",
          available: true,
          reason: null,
          health: { state: 0, detail: null },
        },
      ],
    } as unknown as RawSystemUplinksPayload;
    expect(
      deriveSystemUplinkHealth(fakeGet(uplinksPoint(raw)))?.uplinks[0]?.health
        .facts,
    ).toEqual([]);
  });

  it("defaults ownedPrefixes to an empty array for a pre-Phase-1 mod build (wire field absent)", () => {
    const raw = {
      uplinks: [
        {
          id: "legacy",
          version: "1.0.0",
          available: true,
          reason: null,
          health: { state: 0, detail: null },
        },
      ],
    } as unknown as RawSystemUplinksPayload;
    expect(
      deriveSystemUplinkHealth(fakeGet(uplinksPoint(raw)))?.uplinks[0]
        ?.ownedPrefixes,
    ).toEqual([]);
  });

  it("falls back to unavailable for an out-of-range health.state ordinal; never throws", () => {
    const raw: RawSystemUplinksPayload = {
      uplinks: [
        {
          id: "future-uplink",
          version: "2.0.0",
          available: true,
          reason: null,
          health: { state: 99, detail: null },
        },
      ],
    };
    expect(
      deriveSystemUplinkHealth(fakeGet(uplinksPoint(raw)))?.uplinks[0]?.health
        .state,
    ).toBe("unavailable");
  });

  it("undefined while system.uplinks hasn't arrived (resyncing): never throws", () => {
    expect(deriveSystemUplinkHealth(fakeGet(undefined))).toBeUndefined();
  });

  it("null on a confirmed system.uplinks tombstone", () => {
    expect(deriveSystemUplinkHealth(fakeGet(uplinksPoint(null)))).toBeNull();
  });

  it("empty array reads as defined, not resyncing", () => {
    expect(
      deriveSystemUplinkHealth(fakeGet(uplinksPoint({ uplinks: [] }))),
    ).toEqual({ uplinks: [] });
  });
});
