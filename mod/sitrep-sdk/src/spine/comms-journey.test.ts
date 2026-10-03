import { describe, expect, it } from "vitest";
import { JourneyEventKind } from "../__generated__/contract";
import { value } from "../unit-system/value";
import {
  heldAt,
  heldCommandOf,
  journeyOf,
  outcomeOf,
  readJourney,
} from "./comms-journey";

const event = (over: Record<string, unknown>) => ({
  id: "e",
  about: "r1",
  craft: "vessel:probe",
  laneSeq: 1,
  kind: JourneyEventKind.Held,
  at: "ground:ksc",
  atUt: 100,
  missing: [],
  ...over,
});

describe("readJourney", () => {
  it("reads events and the timeline, bare numbers or wrapped values alike", () => {
    const journey = readJourney({
      epoch: value("count", 4),
      events: [
        event({ untilUt: value("ut", 900) }),
        event({
          id: "e2",
          kind: JourneyEventKind.Waiting,
          missing: [2, value("count", 3)],
        }),
      ],
    });
    expect(journey?.epoch.equals(value("count", 4))).toBe(true);
    expect(journey?.events.map((e) => e.kind)).toEqual([
      JourneyEventKind.Held,
      JourneyEventKind.Waiting,
    ]);
    expect(journey?.events[0].untilUt?.equals(value("ut", 900))).toBe(true);
    expect(journey?.events[1].missing.map((n) => n.magnitude)).toEqual([2, 3]);
  });

  it("leaves out a malformed event and an unknown kind, and refuses a payload that is not one", () => {
    const journey = readJourney({
      epoch: 1,
      events: [event({}), event({ kind: 99 }), event({ atUt: "soon" }), null],
    });
    expect(journey?.events).toHaveLength(1);
    expect(readJourney(null)).toBeNull();
    expect(readJourney({ epoch: 1 })).toBeNull();
  });
});

describe("one command's journey", () => {
  const journey = readJourney({
    epoch: 1,
    events: [
      event({
        id: "a",
        kind: JourneyEventKind.Departed,
        at: "vessel:relay",
        atUt: 900,
        untilUt: 901,
      }),
      event({
        id: "b",
        kind: JourneyEventKind.Held,
        at: "vessel:relay",
        atUt: 300,
        untilUt: 900,
      }),
      event({ id: "c", laneSeq: 2, kind: JourneyEventKind.Held, atUt: 50 }),
    ],
  });
  if (journey === null) throw new Error("journey did not read");
  const lane1 = journeyOf(journey, "vessel:probe", value("count", 1));

  it("is ordered by when things happened at their nodes, not by arrival", () => {
    expect(lane1.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("is waiting nowhere once a departure follows its hold", () => {
    expect(heldAt(lane1)).toBeUndefined();
    expect(heldAt(lane1.slice(0, 1))).toEqual({
      node: "vessel:relay",
      untilUt: value("ut", 900),
    });
  });

  it("waits at the craft behind a gap", () => {
    const waiting = readJourney({
      epoch: 1,
      events: [
        event({
          kind: JourneyEventKind.Waiting,
          at: "vessel:probe",
          missing: [0],
        }),
      ],
    });
    expect(heldAt(waiting?.events ?? [])?.node).toBe("vessel:probe");
  });
});

describe("outcomeOf", () => {
  const read = (...events: Record<string, unknown>[]) =>
    readJourney({ epoch: 1, events: events.map(event) })?.events ?? [];

  it("is unsettled while the command is only held or departed", () => {
    expect(
      outcomeOf(
        read(
          { kind: JourneyEventKind.Held },
          { kind: JourneyEventKind.Departed },
        ),
      ),
    ).toBeUndefined();
  });

  it("settles on a run, an expiry, a stop or a stored cancel", () => {
    expect(outcomeOf(read({ kind: JourneyEventKind.Ran }))).toBe("ran");
    expect(outcomeOf(read({ kind: JourneyEventKind.Expired }))).toBe("expired");
    expect(outcomeOf(read({ kind: JourneyEventKind.Cancelled }))).toBe(
      "cancelled",
    );
    expect(outcomeOf(read({ kind: JourneyEventKind.CancelStored }))).toBe(
      "cancelled",
    );
    expect(outcomeOf(read({ kind: JourneyEventKind.CancelLate }))).toBe(
      "cancelLate",
    );
  });

  it("does not settle on a discarded duplicate copy, but does on a discard for any other reason", () => {
    expect(
      outcomeOf(
        read({
          kind: JourneyEventKind.Discarded,
          detail: "a copy is already waiting",
        }),
      ),
    ).toBeUndefined();
    expect(
      outcomeOf(
        read({ kind: JourneyEventKind.Discarded, detail: "cancelled" }),
      ),
    ).toBe("cancelled");
    expect(
      outcomeOf(
        read({ kind: JourneyEventKind.Discarded, detail: "its lane moved on" }),
      ),
    ).toBe("discarded");
  });
});

describe("heldCommandOf", () => {
  it("reads the held facts of a laned pending entry", () => {
    const held = heldCommandOf({
      id: "r1",
      laneSeq: 3,
      craft: "vessel:probe",
      expiresAtUt: value("ut", 3700),
      predictedHeldAt: "vessel:relay",
      predictedHeldUntilUt: 900,
      cancelDeadlineUt: 800,
      attempts: 2,
      members: ["ground:ksc", 7],
    });
    expect(held?.laneSeq.magnitude).toBe(3);
    expect(held?.predictedHeldAt).toBe("vessel:relay");
    expect(held?.predictedHeldUntilUt?.magnitude).toBe(900);
    expect(held?.attempts.magnitude).toBe(2);
    expect(held?.members).toEqual(["ground:ksc"]);
  });

  it("is undefined for an entry on no lane", () => {
    expect(
      heldCommandOf({ id: "r1", laneSeq: null, craft: "vessel:probe" }),
    ).toBeUndefined();
    expect(heldCommandOf({ id: "r1" })).toBeUndefined();
  });
});
