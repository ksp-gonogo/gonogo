import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import type { KerbalismLifeSupport } from "../__generated__/contract";
import { computeKerbalismPartMeta } from "./partMeta";

/**
 * One fitted process with the given running/broken pair, taken through a JSON
 * round-trip rather than handed over as a typed object.
 *
 * That is the whole point of the unread cases below. Codegen types a `bool?` as
 * `boolean | undefined`, but the mod writes an unread flag as JSON NULL with the
 * key still on the wire, so a null is what actually reaches the contribution and
 * the generated type says it cannot happen (the same trap `ScienceFileManager`'s
 * `DriveCapacity` records). Parsing the frame reproduces exactly that: a null
 * survives, an omitted key stays omitted, and no assertion is needed to get
 * there.
 */
function processFixture(flags: Record<string, unknown>): KerbalismLifeSupport {
  return JSON.parse(
    JSON.stringify({
      processes: [{ title: "Greenhouse", flightId: 7, ...flags }],
    }),
  );
}

describe("computeKerbalismPartMeta", () => {
  it("emits a running-process row, keyed by its host part", () => {
    const lifeSupport: KerbalismLifeSupport = {
      processes: [
        {
          resource: "recycler",
          title: "Water Recycler",
          capacity: value("units", 1),
          running: true,
          broken: false,
          flightId: 3,
        },
      ],
    };
    expect(computeKerbalismPartMeta(lifeSupport)).toEqual([
      {
        partId: "3",
        label: "Water Recycler",
        tone: "go",
        kind: "text",
        text: "running",
      },
    ]);
  });

  it("flags a broken process nogo, over running", () => {
    const lifeSupport: KerbalismLifeSupport = {
      processes: [
        {
          title: "Scrubber",
          running: true,
          broken: true,
          flightId: 5,
        },
      ],
    };
    expect(computeKerbalismPartMeta(lifeSupport)[0]).toMatchObject({
      tone: "nogo",
      text: "broken",
    });
  });

  it("labels a fitted-but-idle process idle, neutral tone", () => {
    const lifeSupport: KerbalismLifeSupport = {
      processes: [
        { title: "Greenhouse", running: false, broken: false, flightId: 7 },
      ],
    };
    expect(computeKerbalismPartMeta(lifeSupport)[0]).toMatchObject({
      tone: "neutral",
      text: "idle",
    });
  });

  it.each([
    ["the broken flag arrives null", { running: false, broken: null }],
    ["the running flag arrives null", { running: null, broken: false }],
    ["both arrive null", { running: null, broken: null }],
    ["neither key is on the wire", {}],
  ])("says unknown, not idle, when %s", (_which, flags) => {
    expect(computeKerbalismPartMeta(processFixture(flags))[0]).toMatchObject({
      tone: "warn",
      text: "unknown",
    });
  });

  it("lets a positive running read win over an unread broken flag", () => {
    expect(
      computeKerbalismPartMeta(
        processFixture({ running: true, broken: null }),
      )[0],
    ).toMatchObject({
      tone: "go",
      text: "running",
    });
  });

  it("falls back to the process's resource token when no title is set", () => {
    const lifeSupport: KerbalismLifeSupport = {
      processes: [{ resource: "recycler", running: true, flightId: 9 }],
    };
    expect(computeKerbalismPartMeta(lifeSupport)[0]?.label).toBe("recycler");
  });

  it("skips a process with no host part (no flightId)", () => {
    const lifeSupport: KerbalismLifeSupport = {
      processes: [{ title: "Vessel-wide rule", running: true }],
    };
    expect(computeKerbalismPartMeta(lifeSupport)).toEqual([]);
  });

  it("returns an empty list without a lifesupport payload", () => {
    expect(computeKerbalismPartMeta(undefined)).toEqual([]);
  });
});
