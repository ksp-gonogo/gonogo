import type { CommcastTransmissionRow } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  applyTransmissionRow,
  DETECTION_LAPSE_SECONDS,
  strangersOnAir,
} from "./detected";

function row(over: Partial<CommcastTransmissionRow> = {}) {
  return {
    phase: "open",
    transmissionId: "t1",
    groupId: "g1",
    from: "ground:woomera",
    author: { name: "Jeb", seat: "pilot", stationKey: "station-a" },
    startedUt: 100,
    to: ["ground:woomera", "vessel:ares"],
    topic: "commcast.radio",
    ...over,
  } as CommcastTransmissionRow;
}

const none = () => false;

describe("applyTransmissionRow", () => {
  it("holds an open keying, and drops it on its ended row", () => {
    const open = applyTransmissionRow(new Map(), row(), 101);
    expect(open.get("t1")).toMatchObject({
      groupId: "g1",
      authorName: "Jeb",
      authorSeat: "pilot",
      startedUt: 100,
      heardUt: 101,
    });
    expect(applyTransmissionRow(open, row({ phase: "ended" }), 105).size).toBe(
      0,
    );
  });

  it("refreshes the time a keying was last heard", () => {
    const first = applyTransmissionRow(new Map(), row(), 101);
    const again = applyTransmissionRow(first, row(), 102);
    expect(again.get("t1")?.heardUt).toBe(102);
  });

  it("forgets a keying whose ended row never came", () => {
    const first = applyTransmissionRow(new Map(), row(), 101);
    const later = applyTransmissionRow(
      first,
      row({ transmissionId: "t2" }),
      101 + DETECTION_LAPSE_SECONDS + 1,
    );
    expect([...later.keys()]).toEqual(["t2"]);
  });

  it("ignores a phase it does not know", () => {
    const held = applyTransmissionRow(new Map(), row(), 101);
    expect(applyTransmissionRow(held, row({ phase: "weird" }), 102)).toBe(held);
  });
});

describe("strangersOnAir", () => {
  const held = applyTransmissionRow(new Map(), row(), 101);

  it("lists a keying to a group this screen is not in", () => {
    expect(strangersOnAir(held, 102, "station-b", none)).toHaveLength(1);
  });

  it("leaves out a group this screen belongs to, which the audio already lights", () => {
    expect(strangersOnAir(held, 102, "station-b", (id) => id === "g1")).toEqual(
      [],
    );
  });

  it("leaves out this screen's own keying", () => {
    expect(strangersOnAir(held, 102, "station-a", none)).toEqual([]);
  });

  it("stops listing a keying that has gone quiet, and lists nothing before the clock reads", () => {
    expect(
      strangersOnAir(held, 101 + DETECTION_LAPSE_SECONDS + 1, "x", none),
    ).toEqual([]);
    expect(strangersOnAir(held, undefined, "x", none)).toEqual([]);
  });
});
