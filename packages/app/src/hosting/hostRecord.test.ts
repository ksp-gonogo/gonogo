import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { readHostRecord, readRoleAnswer } from "./hostRecord";

describe("the game's host record as the page reads it", () => {
  it("keeps each approved station, its approval time arriving as a unit value", () => {
    const record = readHostRecord({
      held: true,
      holderAway: false,
      holderId: "abc",
      code: "ABC234",
      stations: [{ id: "s1", name: "Flight", approvedAt: value("count", 42) }],
    });

    expect(record?.stations).toEqual([
      { id: "s1", name: "Flight", approvedAt: 42 },
    ]);
  });

  it("reads the role answer's intervals as plain seconds", () => {
    expect(
      readRoleAnswer({
        success: true,
        payload: {
          holds: true,
          holderId: "abc",
          heartbeatSeconds: value("s", 5),
          graceSeconds: value("s", 15),
          generation: value("count", 4),
        },
      }),
    ).toEqual({
      holds: true,
      holderId: "abc",
      heartbeatSeconds: 5,
      graceSeconds: 15,
      generation: 4,
    });
  });

  it("is no record at all when a field is missing", () => {
    expect(readHostRecord({ held: true })).toBeUndefined();
  });
});
