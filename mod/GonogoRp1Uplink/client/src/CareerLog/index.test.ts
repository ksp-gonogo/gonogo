import { describe, expect, it } from "vitest";
import type { Rp1CareerEvents } from "../__generated__/contract";
import { computeCareerLogSource } from "./index";

/**
 * The mapping from RP-1's career log onto the Mission Log's source slot. What
 * the host does with a source (merges, sorts, drops a lone group marker) is the
 * host's own suite; what belongs here is that the source says true things about
 * RP-1.
 */

const funds = (magnitude: number) => ({ magnitude, unit: "funds" }) as never;
const rep = (magnitude: number) => ({ magnitude, unit: "rep" }) as never;
const ut = (magnitude: number) => ({ magnitude, unit: "ut" }) as never;

const payload = (events: Rp1CareerEvents["events"]): Rp1CareerEvents => ({
  enabled: true,
  events,
});

describe("RP-1 career log as a Mission Log source", () => {
  /**
   * The three states the slot exists to keep apart. An empty event list means
   * something different in each, and a boolean could only carry two of them.
   */
  it("separates a silent handler from a switched-off log from a quiet career", () => {
    expect(computeCareerLogSource(undefined)[0].state).toBe("unreadable");
    expect(computeCareerLogSource({ enabled: false })[0].state).toBe(
      "not-recording",
    );
    expect(computeCareerLogSource(payload([]))[0]).toMatchObject({
      state: "recording",
      events: [],
    });
  });

  /**
   * A payload that arrived without saying whether the log is kept is unreadable
   * rather than recording. Reading absent as on would turn a handler that
   * answered incompletely into a claim that the career is quiet.
   */
  it("does not read a missing enabled flag as recording", () => {
    expect(computeCareerLogSource({ events: [] })[0].state).toBe("unreadable");
  });

  it("carries a leader's cost and a contract's reputation as typed figures", () => {
    const [source] = computeCareerLogSource(
      payload([
        { ut: ut(10), kind: "leader", name: "Von Braun", cost: funds(25_000) },
        {
          ut: ut(20),
          kind: "contract",
          name: "First Orbit",
          repChange: rep(12.5),
        },
        { ut: ut(30), kind: "launch", name: "Ares I" },
      ]),
    );

    const [leader, contract, launch] = source.events ?? [];
    expect(leader.amount).toEqual({ magnitude: 25_000, unit: "funds" });
    expect(contract.amount).toEqual({ magnitude: 12.5, unit: "rep" });
    // Not zero. A launch costs nothing on this row because the row is not about
    // money, and a 0f would say the flight was free.
    expect(launch.amount).toBeUndefined();
  });

  /**
   * The join a career log gets opened for. The host only marks a group two rows
   * share, so contributing the launch id is the whole of our side.
   */
  it("gives a failure and its launch the same group", () => {
    const [source] = computeCareerLogSource(
      payload([
        { ut: ut(10), kind: "launch", name: "Ares I", launchId: "L-7" },
        {
          ut: ut(20),
          kind: "failure",
          name: "engine-1",
          detail: "ignitionFail",
          launchId: "L-7",
        },
      ]),
    );

    const [launch, failure] = source.events ?? [];
    expect(launch.groupId).toBe("L-7");
    expect(failure.groupId).toBe("L-7");
    expect(failure.severity).toBe("warning");
    // The only kind that is not something the operator did on purpose.
    expect(launch.severity).toBeUndefined();
  });

  /**
   * Two rows RP-1 recorded at one instant with identical content, which is what
   * a leader swap looks like. The host keys rows by id, so a shared one would
   * render a swap as a single event.
   */
  it("keeps two identical rows at one instant apart", () => {
    const [source] = computeCareerLogSource(
      payload([
        { ut: ut(10), kind: "leader", name: "Von Braun", cost: funds(25_000) },
        { ut: ut(10), kind: "leader", name: "Von Braun", cost: funds(25_000) },
      ]),
    );

    const ids = (source.events ?? []).map((e) => e.id);
    expect(new Set(ids).size).toBe(2);
  });

  /**
   * An id derived from position would renumber every later row when an earlier
   * one arrives, remounting rows that did not change.
   */
  it("keeps a row's id stable when an earlier row appears before it", () => {
    const later = {
      ut: ut(20),
      kind: "launch" as const,
      name: "Ares I",
    };
    const before = computeCareerLogSource(payload([later]));
    const after = computeCareerLogSource(
      payload([{ ut: ut(10), kind: "contract", name: "First Orbit" }, later]),
    );

    expect(after[0].events?.[1].id).toBe(before[0].events?.[0].id);
  });

  /**
   * A row with no instant cannot be placed on a timeline. Publishing it at zero
   * would date it to the founding of the space programme.
   */
  it("drops a row that has no instant rather than dating it to zero", () => {
    const [source] = computeCareerLogSource(
      payload([
        { kind: "launch", name: "undated" },
        { ut: ut(10), kind: "launch", name: "Ares I" },
      ]),
    );

    expect((source.events ?? []).map((e) => e.label)).toEqual(["Ares I"]);
  });

  /**
   * The chips RP-1's own CSV uses for its columns, not a title-cased wire value.
   */
  it("names the two multi-word kinds the way RP-1's own export does", () => {
    const [source] = computeCareerLogSource(
      payload([
        { ut: ut(10), kind: "facilityConstruction", name: "LaunchPad" },
        { ut: ut(20), kind: "techResearch", name: "supersonicFlight" },
      ]),
    );

    expect((source.events ?? []).map((e) => e.kindLabel)).toEqual([
      "facility",
      "tech",
    ]);
  });
});
