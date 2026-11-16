import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { outboundItems } from "./outboundItems";
import type { CommsAck, CommsMessage, OutboundMessage } from "./types";

const NEAR = "ground:near";
const FAR = "vessel:far";

function twoRecipients(acks: CommsAck[] = []): OutboundMessage {
  const msg: CommsMessage = {
    id: "m1",
    groupId: "g1",
    to: ["ksc", NEAR, FAR],
    from: "ksc",
    authorStationKey: "key",
    authorName: "KSC",
    authorSeat: "mission-control",
    sentUt: value("ut", 1000),
    lastSentUt: value("ut", 1000),
    attempts: 1,
    separationSeconds: value("s", 600),
    kind: "text",
    body: "go",
  };
  const delivery = (to: string, separationSeconds: number) => ({
    to,
    separationSeconds: value("s", separationSeconds),
    lastSentUt: value("ut", 1000),
    attempts: 1,
    neverLeft: false,
  });
  return {
    msg,
    acks,
    deliveries: [delivery(NEAR, 2), delivery(FAR, 600)],
  };
}

describe("outboundItems", () => {
  it("gives a two-recipient message two rows, each on its own clock", () => {
    const rows = outboundItems(
      [twoRecipients()],
      value("ut", 1001),
      (id) => id.split(":")[1] ?? id,
    );
    expect(rows.map((r) => r.id)).toEqual(["m1/ground:near", "m1/vessel:far"]);
    expect(rows.map((r) => r.label)).toEqual(["go, to near", "go, to far"]);
    expect(rows[0]?.etaSeconds).toBe(1);
    expect(rows[1]?.etaSeconds).toBe(599);
    expect(rows[0]?.progress).not.toBe(rows[1]?.progress);
  });

  it("drops the recipient that answered and keeps the one still on its way", () => {
    const answered: CommsAck = {
      messageId: "m1",
      from: NEAR,
      stationKey: "near-1",
      seat: "mission-control",
      atUt: value("ut", 1002),
      arrivedUt: value("ut", 1004),
    };
    const rows = outboundItems([twoRecipients([answered])], value("ut", 1005));
    expect(rows.map((r) => r.id)).toEqual(["m1/vessel:far"]);
  });

  it("drops a recipient whose own wait has run out", () => {
    // The near recipient's wait ends at 1000 + 2 * 2 + 3.
    const rows = outboundItems([twoRecipients()], value("ut", 1008));
    expect(rows.map((r) => r.id)).toEqual(["m1/vessel:far"]);
  });

  it.each([
    [0.4, 0],
    [1.0, 0],
    [1.5, 1],
  ])("at %s s one-way, shows %s box row(s)", (seconds, rows) => {
    const base = twoRecipients();
    const out: OutboundMessage = {
      ...base,
      deliveries: [
        { ...base.deliveries[0], separationSeconds: value("s", seconds) },
      ],
    };
    expect(outboundItems([out], value("ut", 1000.1))).toHaveLength(rows);
  });
});
