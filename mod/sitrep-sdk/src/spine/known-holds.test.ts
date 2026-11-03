import { describe, expect, it } from "vitest";
import { JourneyEventKind } from "../__generated__/contract";
import type { PendingEntry } from "../command-delay";
import { value } from "../unit-system/value";
import type { Journey, JourneyEvent } from "./comms-journey";
import { entryAsKnown } from "./known-holds";

// Sent at 1000 to a craft 10 s of light away, through a relay 4 s out that the plan says holds it until 1012.
const held: PendingEntry = {
  id: "c1",
  clientRequestId: "station:c1",
  command: "vessel.control.setRcs",
  label: "Toggle RCS",
  topic: "",
  vantage: "ground:Kerbin: KSC",
  dispatchedAt: value("ut", 1000),
  oneWaySeconds: value("s", 18),
  laneSeq: value("count", 1),
  expiresAtUt: value("ut", 4600),
  predictedHeldAt: "relay-1",
  predictedHeldFromUt: value("ut", 1004),
  predictedHeldUntilUt: value("ut", 1012),
  predictedArrivalUt: value("ut", 1018),
  predictedReplyUt: value("ut", 1028),
};

function report(over: Partial<JourneyEvent>): JourneyEvent {
  return {
    id: "r1",
    about: "c1",
    craft: "vessel:abc",
    laneSeq: value("count", 1),
    kind: JourneyEventKind.Held,
    at: "relay-1",
    atUt: value("ut", 1004),
    untilUt: value("ut", 1012),
    missing: [],
    ...over,
  };
}

const journey = (...events: JourneyEvent[]): Journey => ({
  epoch: value("count", 0),
  events,
});

const ut = (v: { magnitude: number } | null | undefined) => v?.magnitude;

describe("a command the plan says will wait at a relay", () => {
  it("is drawn going straight out at the speed of light until the relay's hold report has come home", () => {
    const known = entryAsKnown(held, journey());
    expect(known.predictedHeldAt).toBeNull();
    expect(known.predictedHeldFromUt).toBeNull();
    expect(known.predictedHeldUntilUt).toBeNull();
    // 4 s to the relay and 6 s on: 10 s out, and the plan's 10 s back.
    expect(ut(known.predictedArrivalUt)).toBe(1010);
    expect(ut(known.predictedReplyUt)).toBe(1020);
  });

  it("waits at the relay the report names, from when the report says, until its departure is heard", () => {
    const known = entryAsKnown(held, journey(report({})));
    expect(known.predictedHeldAt).toBe("relay-1");
    expect(ut(known.predictedHeldFromUt)).toBe(1004);
    // No departure heard: held for as long as it can last there.
    expect(ut(known.predictedHeldUntilUt)).toBe(4600);
    expect(ut(known.predictedArrivalUt)).toBe(4606);
  });

  it("goes on from when the relay's departure report says it left", () => {
    const known = entryAsKnown(
      held,
      journey(
        report({}),
        report({
          id: "r2",
          kind: JourneyEventKind.Departed,
          atUt: value("ut", 1013),
          untilUt: value("ut", 1019),
        }),
      ),
    );
    expect(ut(known.predictedHeldUntilUt)).toBe(1013);
    expect(ut(known.predictedArrivalUt)).toBe(1019);
    expect(ut(known.predictedReplyUt)).toBe(1029);
  });

  it("is known held at once when it waits at the centre that sent it", () => {
    const atHome = { ...held, predictedHeldAt: held.vantage };
    expect(entryAsKnown(atHome, journey())).toBe(atHome);
  });

  it("ignores reports about other commands", () => {
    const known = entryAsKnown(held, journey(report({ about: "c9" })));
    expect(known.predictedHeldAt).toBeNull();
  });
});
