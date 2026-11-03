import { describe, expect, it } from "vitest";
import type { CommandStatus } from "../api/types";
import type { PendingEntry, SettledEntry } from "../command-delay";
import { value } from "../unit-system/value";
import {
  centreCommandOutcomes,
  centreCommandRows,
  createCentreCommandMemory,
  dismissCentreOutcome,
} from "./centre-commands";

function entry(over: Partial<PendingEntry> = {}): PendingEntry {
  return {
    id: "engine-1",
    clientRequestId: "station-ab12:c1",
    command: "vessel.control.setRcs",
    label: "Toggle RCS",
    topic: "",
    vantage: "ground:Kerbin: KSC",
    dispatchedAt: value("ut", 1000),
    oneWaySeconds: value("s", 20),
    ...over,
  };
}

function rows(
  pending: PendingEntry[],
  opts: {
    memory?: ReturnType<typeof createCentreCommandMemory>;
    own?: string[];
    nowUt?: number;
    connected?: boolean;
    status?: CommandStatus;
  } = {},
) {
  return centreCommandRows({
    command: "vessel.control.setRcs",
    queue: { pending },
    own: new Set(opts.own ?? []),
    memory: opts.memory ?? createCentreCommandMemory(),
    nowUt: opts.nowUt ?? 1005,
    pathConnectedDuring: () => opts.connected ?? true,
    statusOf: () => opts.status,
  });
}

describe("centreCommandRows", () => {
  it("draws a queued command of this command that this hook did not send, under the sender's id", () => {
    expect(rows([entry()]).map((r) => [r.id, r.predictedPhase])).toEqual([
      ["station-ab12:c1", "in-transit"],
    ]);
  });

  it("leaves out this hook's own dispatches, a group's members included, and other commands", () => {
    expect(
      rows(
        [
          entry(),
          entry({ id: "engine-2", clientRequestId: "t:c2", members: ["t:c2"] }),
          entry({ id: "engine-3", command: "vessel.control.setSas" }),
        ],
        { own: ["station-ab12:c1", "t:c2"] },
      ),
    ).toEqual([]);
  });

  it("marks a command the route holds at a relay as held", () => {
    const [row] = rows([
      entry({
        laneSeq: value("count", 1),
        predictedHeldAt: "relay-1",
        predictedHeldUntilUt: value("ut", 1500),
        predictedArrivalUt: value("ut", 1527),
        predictedReplyUt: value("ut", 1554),
      }),
    ]);
    expect(row.held).toBe(true);
  });

  it("places a held command's wait: how far the relay is, and when it reaches and leaves it", () => {
    const [row] = rows(
      [
        entry({
          laneSeq: value("count", 1),
          predictedHeldAt: "relay-1",
          predictedHeldFromUt: value("ut", 1004),
          predictedHeldUntilUt: value("ut", 1500),
          predictedArrivalUt: value("ut", 1508),
          predictedReplyUt: value("ut", 1520),
        }),
      ],
      { nowUt: 1005 },
    );
    // 4 s to the relay and 8 s on: a third of the way out, while it waits.
    expect(row.hold?.outbound).toBeCloseTo(1 / 3, 5);
  });

  it("places a held command's wait from the sending centre's predictions alone, and not at all without them", () => {
    const held = {
      laneSeq: value("count", 1),
      predictedHeldAt: "relay-1",
      predictedHeldUntilUt: value("ut", 1500),
      predictedArrivalUt: value("ut", 1508),
      predictedReplyUt: value("ut", 1520),
    };
    // With no predicted time at the relay there is nothing to place the wait by: no journey report or live state stands in for it.
    const [unplaced] = rows([entry(held)], { nowUt: 1005 });
    expect(unplaced.held).toBe(true);
    expect(unplaced.hold).toBeUndefined();
    // The same predictions read later give the same place, moved only by the clock.
    const placed = (nowUt: number) =>
      rows([entry({ ...held, predictedHeldFromUt: value("ut", 1004) })], {
        nowUt,
      })[0].hold;
    expect(placed(1100)?.outbound).toBeCloseTo(1 / 3, 5);
    // Gone on from the relay at 1500 and half way through its 8 s to the craft.
    expect(placed(1504)?.outbound).toBeCloseTo(1 / 3 + (2 / 3) * 0.5, 5);
  });

  it("drops a row when its entry leaves the queue on time", () => {
    const memory = createCentreCommandMemory();
    rows([entry()], { memory });
    expect(rows([], { memory, nowUt: 1041 })).toEqual([]);
  });

  it("keeps a lost row after its entry leaves the queue, until dismissed", () => {
    const memory = createCentreCommandMemory();
    expect(
      rows([entry()], { memory, connected: false })[0].predictedPhase,
    ).toBe("lost");
    expect(
      rows([], { memory, connected: false }).map((r) => r.predictedPhase),
    ).toEqual(["lost"]);
    memory.dismissed.add("station-ab12:c1");
    expect(rows([], { memory, connected: false })).toEqual([]);
    expect(memory.entries.size).toBe(0);
  });

  it("settles a row this screen heard answered, and calls lost one it judged lost", () => {
    expect(
      rows([entry()], {
        status: {
          phase: "confirmed",
          requestId: "station-ab12:c1",
          result: {},
        },
      }),
    ).toEqual([]);
    expect(
      rows([entry()], {
        status: { phase: "lost", requestId: "station-ab12:c1", reason: "" },
      })[0].predictedPhase,
    ).toBe("lost");
  });
});

function settled(over: Partial<SettledEntry> = {}): SettledEntry {
  return {
    id: "engine-1",
    clientRequestId: "station-ab12:c1",
    command: "vessel.control.setRcs",
    label: "Toggle RCS",
    topic: "",
    vantage: "ground:Kerbin: KSC",
    settledAt: value("ut", 1040),
    outcome: "refused",
    code: "modeUnavailable",
    ...over,
  };
}

function outcomes(
  list: SettledEntry[],
  opts: {
    memory?: ReturnType<typeof createCentreCommandMemory>;
    own?: string[];
    nowUt?: number;
  } = {},
) {
  return centreCommandOutcomes({
    command: "vessel.control.setRcs",
    queue: { pending: [], settled: list },
    own: new Set(opts.own ?? []),
    memory: opts.memory ?? createCentreCommandMemory(),
    nowUt: opts.nowUt ?? 1041,
  });
}

describe("centreCommandOutcomes", () => {
  it("lists another screen's refused command as a refusal, under the sender's id", () => {
    const memory = createCentreCommandMemory();
    outcomes([], { memory, nowUt: 1000 });
    expect(
      outcomes([settled({ detail: "No RCS thrusters aboard" })], { memory })
        .refusals,
    ).toEqual([
      {
        id: "station-ab12:c1",
        command: "vessel.control.setRcs",
        args: undefined,
        label: "Toggle RCS",
        errorCode: "modeUnavailable",
        reason: undefined,
        detail: "No RCS thrusters aboard",
      },
    ]);
  });

  it("lists a failed one as a failure, with the mod's words", () => {
    const memory = createCentreCommandMemory();
    outcomes([], { memory, nowUt: 1000 });
    const { failures, refusals } = outcomes(
      [
        settled({
          outcome: "failed",
          code: "commandExpired",
          message: "It expired at a relay.",
        }),
      ],
      { memory },
    );
    expect(refusals).toEqual([]);
    expect(failures.map((f) => [f.id, f.code, f.reason])).toEqual([
      ["station-ab12:c1", "commandExpired", "It expired at a relay."],
    ]);
  });

  it("leaves out this hook's own dispatches, other commands, and outcomes from before it looked", () => {
    const memory = createCentreCommandMemory();
    outcomes([], { memory, nowUt: 1000 });
    expect(
      outcomes(
        [
          settled({ clientRequestId: "mine:c1" }),
          settled({ id: "engine-2", clientRequestId: "s:c2", command: "x" }),
          settled({
            id: "engine-3",
            clientRequestId: "s:c3",
            settledAt: value("ut", 990),
          }),
        ],
        { memory, own: ["mine:c1"] },
      ).refusals,
    ).toEqual([]);
  });

  it("keeps an outcome after the centre stops listing it, until dismissed", () => {
    const memory = createCentreCommandMemory();
    outcomes([], { memory, nowUt: 1000 });
    outcomes([settled()], { memory });
    expect(outcomes([], { memory }).refusals).toHaveLength(1);
    dismissCentreOutcome(memory, "station-ab12:c1");
    expect(outcomes([settled()], { memory }).refusals).toEqual([]);
    expect(outcomes([], { memory }).refusals).toEqual([]);
    expect(memory.outcomes.size).toBe(0);
  });
});

describe("a late answer the centre reports", () => {
  const overdue = entry({ replyOverdueUt: value("ut", 1043) });
  const answered = settled({
    outcome: "answered",
    code: "",
    settledAt: value("ut", 1049),
  });

  it("ends a row waiting overdue and is told as a found that ran, as the sender's own is", () => {
    const memory = createCentreCommandMemory();
    const opts = { memory, nowUt: 1044 };
    expect(rows([overdue], opts).map((r) => r.predictedPhase)).toEqual([
      "overdue",
    ]);
    outcomes([], { memory, nowUt: 1044 });

    const queue = { pending: [], settled: [answered] };
    const after = centreCommandRows({
      command: "vessel.control.setRcs",
      queue,
      own: new Set(),
      memory,
      nowUt: 1050,
      pathConnectedDuring: () => true,
      statusOf: () => undefined,
    });
    expect(after).toEqual([]);
    const told = centreCommandOutcomes({
      command: "vessel.control.setRcs",
      queue,
      own: new Set(),
      memory,
      nowUt: 1050,
    });
    expect(told.founds.map((f) => [f.id, f.outcome])).toEqual([
      ["station-ab12:c1", "ran"],
    ]);
    expect(told.refusals).toEqual([]);
  });

  it("is no news for a row this hook never saw late", () => {
    const memory = createCentreCommandMemory();
    outcomes([], { memory, nowUt: 1000 });
    expect(outcomes([answered], { memory }).founds).toEqual([]);
  });
});
