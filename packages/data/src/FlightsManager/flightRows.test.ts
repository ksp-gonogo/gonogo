import { describe, expect, it } from "vitest";
import { contractsOnRow, flightRows } from "./flightRows";

const flight = (
  id: string,
  vesselName: string,
  launchedAt: number,
  extra: Partial<Parameters<typeof flightRows>[0][number]> = {},
) => ({
  id,
  vesselName,
  launchedAt,
  lastSampleAt: launchedAt + 60_000,
  lastMissionTime: 60,
  sampleCount: 100,
  ...extra,
});

describe("flightRows", () => {
  it("folds every open recording of a craft still flying into one row, newest first", () => {
    const rows = flightRows(
      [
        flight("c4", "orbit-c", 4000),
        flight("c3", "orbit-c", 3000),
        flight("c2", "orbit-c", 2000),
        flight("c1", "orbit-c", 1000),
      ],
      new Set(["orbit-c"]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.stillFlying).toBe(true);
    expect(rows[0]?.flight.id).toBe("c4");
    expect(rows[0]?.ids).toEqual(["c4", "c3", "c2", "c1"]);
    expect(rows[0]?.launchedAt).toBe(1000);
    expect(rows[0]?.sampleCount).toBe(400);
    expect(rows[0]?.durationMs).toBe(240_000);
  });

  it("keeps one row per recording for a craft that is not known to be flying", () => {
    const rows = flightRows(
      [flight("c2", "orbit-c", 2000), flight("c1", "orbit-c", 1000)],
      new Set(),
    );
    expect(rows.map((r) => r.ids)).toEqual([["c2"], ["c1"]]);
    expect(rows.every((r) => !r.stillFlying)).toBe(true);
  });

  it("leaves a recording that has its end on its own row", () => {
    const rows = flightRows(
      [
        flight("c3", "orbit-c", 3000),
        flight("c2", "orbit-c", 2000, { endReason: 0 }),
        flight("c1", "orbit-c", 1000),
      ],
      new Set(["orbit-c"]),
    );
    expect(rows.map((r) => r.ids)).toEqual([["c3", "c1"], ["c2"]]);
    expect(rows.map((r) => r.stillFlying)).toEqual([true, false]);
  });

  it("never folds recordings of different craft together", () => {
    const rows = flightRows(
      [flight("b1", "orbit-b", 2000), flight("c1", "orbit-c", 1000)],
      new Set(["orbit-b", "orbit-c"]),
    );
    expect(rows).toHaveLength(2);
  });
});

describe("contractsOnRow", () => {
  const finish = (id: string, validAt: number) => ({
    id,
    title: id,
    outcome: "Completed" as const,
    validAt,
    deliveredAt: validAt + 5,
  });

  it("holds the finishes inside the span of every recording a row stands for", () => {
    const [row] = flightRows(
      [
        flight("c2", "orbit-c", 2000, { firstValidUt: 300, lastValidUt: 400 }),
        flight("c1", "orbit-c", 1000, { firstValidUt: 100, lastValidUt: 200 }),
      ],
      new Set(["orbit-c"]),
    );
    const held = contractsOnRow(row, [
      finish("before", 50),
      finish("first", 150),
      finish("second", 350),
      finish("after", 450),
    ]);
    expect(held.map((f) => f.id)).toEqual(["first", "second"]);
  });

  it("holds nothing for a row whose recordings kept no valid-time span", () => {
    const [row] = flightRows([flight("a", "Alpha", 1000)], new Set());
    expect(contractsOnRow(row, [finish("x", 100)])).toEqual([]);
  });
});
