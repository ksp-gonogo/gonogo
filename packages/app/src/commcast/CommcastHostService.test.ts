import { PerfBudget } from "@ksp-gonogo/core";
import { beforeEach, describe, expect, it } from "vitest";
import { CommcastHostService } from "./CommcastHostService";
import type { CommsParticipant, CommsSendInput } from "./types";

function findBudget(name: string) {
  return PerfBudget.getAll().find((b) => b.name === name);
}

const KSC: CommsParticipant = {
  stationKey: "ksc-1",
  name: "Mission Control",
  seat: "mission-control",
};
const PILOT: CommsParticipant = {
  stationKey: "pilot-1",
  name: "Jeb",
  seat: "pilot",
};

function text(over: Partial<CommsSendInput> = {}): CommsSendInput {
  return {
    kind: "text",
    body: "hello",
    sentUt: 1000,
    oneWaySeconds: 240,
    ...over,
  };
}

function host(over: Partial<{ load: () => null }> = {}) {
  let clock = 0;
  return new CommcastHostService({
    now: () => ++clock,
    load: () => null,
    ...over,
  });
}

describe("CommcastHostService", () => {
  beforeEach(() => localStorage.clear());

  it("stamps the local operator onto a locally-composed message", () => {
    const svc = host();
    const msg = svc.post(KSC, text());
    expect(msg.authorName).toBe("Mission Control");
    expect(msg.authorSeat).toBe("mission-control");
    expect(msg.authorStationKey).toBe("ksc-1");
    expect(svc.snapshot().messages).toHaveLength(1);
  });

  it("keeps the author's own frozen separation rather than re-reading one", () => {
    const svc = host();
    const msg = svc.post(PILOT, text({ oneWaySeconds: 17 }));
    expect(msg.oneWaySeconds).toBe(17);
  });

  it("preserves a null separation as no-path, never coercing it to zero", () => {
    const svc = host();
    expect(
      svc.post(PILOT, text({ oneWaySeconds: null })).oneWaySeconds,
    ).toBeNull();
  });

  it("names an author that arrived before its station-info, then patches it", () => {
    const svc = host();
    const msg = svc.post({ ...PILOT, name: "" }, text());
    // Never a bare peer id and never blank: "from the ground" and "from
    // nobody" must not be one value.
    expect(msg.authorName).toBe("Pilot");
    svc.noteParticipant(PILOT);
    expect(svc.snapshot().messages[0]?.authorName).toBe("Jeb");
  });

  it("emits once per commit so the wire cadence is send-on-commit", () => {
    const svc = host();
    const seen: number[] = [];
    svc.subscribe((snap) => seen.push(snap.messages.length));
    svc.post(KSC, text());
    svc.post(KSC, text());
    expect(seen).toEqual([1, 2]);
  });

  it("records a read receipt against the reader's own UT", () => {
    const svc = host();
    const msg = svc.post(KSC, text());
    svc.markRead(PILOT, [msg.id], 1300);
    expect(svc.snapshot().messages[0]?.readBy).toEqual([
      { stationKey: "pilot-1", seat: "pilot", atUt: 1300 },
    ]);
  });

  it("does not re-record a receipt the same reader already left", () => {
    const svc = host();
    const msg = svc.post(KSC, text());
    const seen: number[] = [];
    svc.markRead(PILOT, [msg.id], 1300);
    svc.subscribe(() => seen.push(1));
    svc.markRead(PILOT, [msg.id], 1400);
    expect(seen).toHaveLength(0);
    expect(svc.snapshot().messages[0]?.readBy).toHaveLength(1);
  });

  it("has no delete: a thread cannot un-say something already revealed elsewhere", () => {
    const svc = host();
    expect(svc).not.toHaveProperty("deleteMessage");
  });

  it("survives a refresh, because the transcript is the point", () => {
    const first = new CommcastHostService();
    first.post(KSC, text({ body: "staging nominal" }));
    const second = new CommcastHostService();
    expect(second.snapshot().messages[0]?.body).toBe("staging nominal");
  });

  it("discards a persisted record that is not a message", () => {
    localStorage.setItem("gonogo.commcast.v1", JSON.stringify([{ id: "x" }]));
    expect(new CommcastHostService().snapshot().messages).toHaveLength(0);
  });
});

describe("CommcastHostService cap", () => {
  beforeEach(() => localStorage.clear());

  it("says how many it dropped rather than quietly shortening the transcript", () => {
    const svc = new CommcastHostService();
    for (let i = 0; i < 505; i++) {
      svc.post(KSC, text({ body: `m${i}` }));
    }
    // Filling the cap in one synchronous loop is 505 commits in a tick, which
    // is nothing a human does and everything the broadcast budget exists to
    // catch. Reset it rather than widen the threshold: the cap is what this
    // test is about, the send rate is what the budget is about.
    findBudget("CommcastHostService snapshots/sec")?.reset();
    const snap = svc.snapshot();
    expect(snap.messages).toHaveLength(500);
    expect(snap.droppedCount).toBe(5);
    // The oldest survivor is the sixth message, and the count says so: a
    // reader can tell a gap from nothing having been said.
    expect(snap.messages[0]?.body).toBe("m5");
  });

  it("reports nothing dropped on a thread that has never hit the cap", () => {
    const svc = new CommcastHostService();
    svc.post(KSC, text());
    expect(svc.snapshot().droppedCount).toBe(0);
  });
});
