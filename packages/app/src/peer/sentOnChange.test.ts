import { makeMeta } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import type { PeerMessage } from "./protocol";
import { SentOnChange } from "./sentOnChange";

function landing(payload: Record<string, unknown>): PeerMessage {
  return {
    type: "sitrep-frame",
    message: {
      type: "stream-data",
      topic: "vessel.landing",
      payload,
      meta: makeMeta({ validAt: 1, deliveredAt: 1 }),
    },
  };
}

function frameOf(msg: PeerMessage) {
  if (msg.type !== "sitrep-frame" || msg.message.type !== "stream-data") {
    throw new Error("not a stream-data frame");
  }
  return msg.message;
}

describe("SentOnChange", () => {
  it("leaves out a field the station was last sent, and names it", () => {
    const station = new SentOnChange(() => 0);
    const grid = [1, 2, 3];

    const first = station.prepare(landing({ outcome: "a", siteHeights: grid }));
    first.sent();
    const second = station.prepare(
      landing({ outcome: "b", siteHeights: grid }),
    );

    expect(frameOf(first.outgoing).payload).toHaveProperty("siteHeights", grid);
    expect(frameOf(second.outgoing).payload).toEqual({ outcome: "b" });
    expect(frameOf(second.outgoing).unchanged).toEqual(["siteHeights"]);
  });

  it("sends the field again when the earlier frame never went", () => {
    const station = new SentOnChange(() => 0);
    const grid = [1, 2, 3];

    station.prepare(landing({ siteHeights: grid }));
    const second = station.prepare(landing({ siteHeights: grid }));

    expect(frameOf(second.outgoing).payload).toHaveProperty(
      "siteHeights",
      grid,
    );
  });

  it("sends a new value, and a value that returns after a null, whole", () => {
    const station = new SentOnChange(() => 0);
    const grid = [1, 2, 3];

    station.prepare(landing({ siteHeights: grid })).sent();
    station.prepare(landing({ siteHeights: null })).sent();
    const back = station.prepare(landing({ siteHeights: grid }));
    const retaken = [4, 5, 6];
    back.sent();
    const changed = station.prepare(landing({ siteHeights: retaken }));

    expect(frameOf(back.outgoing).payload).toHaveProperty("siteHeights", grid);
    expect(frameOf(changed.outgoing).payload).toHaveProperty(
      "siteHeights",
      retaken,
    );
  });

  it("sends a held field whole once five seconds have passed, and after a reset", () => {
    let now = 0;
    const station = new SentOnChange(() => now);
    const grid = [1, 2, 3];
    station.prepare(landing({ siteHeights: grid })).sent();

    now = 5_000;
    const late = station.prepare(landing({ siteHeights: grid }));
    late.sent();
    station.forget();
    const afterReset = station.prepare(landing({ siteHeights: grid }));

    expect(frameOf(late.outgoing).payload).toHaveProperty("siteHeights", grid);
    expect(frameOf(afterReset.outgoing).payload).toHaveProperty(
      "siteHeights",
      grid,
    );
  });

  it("passes every other message as it is", () => {
    const station = new SentOnChange(() => 0);
    const reset: PeerMessage = { type: "sitrep-reset" };
    const flight: PeerMessage = {
      type: "sitrep-frame",
      message: {
        type: "stream-data",
        topic: "vessel.flight",
        payload: { altitude: 1 },
        meta: makeMeta({}),
      },
    };

    expect(station.prepare(reset).outgoing).toBe(reset);
    expect(station.prepare(flight).outgoing).toBe(flight);
  });
});
