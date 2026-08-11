import { describe, expect, it } from "vitest";
import type { KerbalismLifeSupport } from "../__generated__/contract";
import { computeKerbalismPartMeta } from "./partMeta";

describe("computeKerbalismPartMeta", () => {
  it("emits a running-process row, keyed by its host part", () => {
    const lifeSupport: KerbalismLifeSupport = {
      processes: [
        {
          resource: "recycler",
          title: "Water Recycler",
          capacity: 1,
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
      processes: [{ title: "Greenhouse", running: false, flightId: 7 }],
    };
    expect(computeKerbalismPartMeta(lifeSupport)[0]).toMatchObject({
      tone: "neutral",
      text: "idle",
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
