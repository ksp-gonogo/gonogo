import { railTagsForCommand } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it, vi } from "vitest";
import type { CommandDelayHandle } from "./CommandDelay";
import { commandOutcomes } from "./commandOutcomes";
import type { InFlightCommandLike } from "./toInFlightListItems";

// The rail axes come from the production derivations, so the fixtures follow them rather than asserting stale literals.
const RAIL_DISCRETE = railTagsForCommand("vessel.control.setSasMode");

function cmd(
  id: string,
  predictedPhase: InFlightCommandLike["predictedPhase"],
): InFlightCommandLike {
  return {
    id,
    label: `Cmd ${id}`,
    command: "vessel.control.setSasMode",
    reachEtaSeconds: 1,
    replyEtaSeconds: 2,
    predictedPhase,
  };
}

function handle(
  inFlight: InFlightCommandLike[],
  dismiss?: (id: string) => void,
): CommandDelayHandle {
  return {
    inFlight,
    tags: RAIL_DISCRETE,
    effectiveDelaySeconds: 1,
    dismiss,
  };
}

describe("commandOutcomes", () => {
  it("selects overdue and lost commands as unconfirmed, never as failed", () => {
    const { unconfirmed, hasUnconfirmed, hasFailure } = commandOutcomes(
      handle([
        cmd("a", "in-transit"),
        cmd("b", "overdue"),
        cmd("c", "lost"),
        cmd("d", "awaiting-reply"),
      ]),
    );
    expect(unconfirmed.map((f) => f.id)).toEqual(["b", "c"]);
    expect(hasUnconfirmed).toBe(true);
    expect(hasFailure).toBe(false);
  });

  it("reports nothing when nothing is overdue, lost or undelivered", () => {
    const { unconfirmed, hasUnconfirmed, hasFailure } = commandOutcomes(
      handle([cmd("a", "in-transit")]),
    );
    expect(unconfirmed).toHaveLength(0);
    expect(hasUnconfirmed).toBe(false);
    expect(hasFailure).toBe(false);
  });

  it("counts a relayed loss with no row as unconfirmed", () => {
    const relayed: CommandDelayHandle = {
      ...handle([]),
      losses: [{ id: "l0", command: "vessel.control.setSas", label: "" }],
    };
    expect(commandOutcomes(relayed).hasUnconfirmed).toBe(true);
    expect(commandOutcomes(relayed).hasFailure).toBe(false);
  });

  it("moves the tint from unconfirmed to failed when a loss is promoted to undelivered", () => {
    // The promotion MOVES the entry out of `losses`: it is now known never to have left.
    const promoted: CommandDelayHandle = {
      ...handle([]),
      losses: [],
      undelivered: [{ id: "u0", command: "vessel.control.setSas", label: "" }],
    };
    expect(commandOutcomes(promoted).hasFailure).toBe(true);
    expect(commandOutcomes(promoted).hasUnconfirmed).toBe(false);
    // An undelivered dispatch has no in-flight row, like a loss.
    expect(commandOutcomes(promoted).unconfirmed).toHaveLength(0);
  });

  it("passes the handle's dismiss straight through", () => {
    const dismiss = vi.fn();
    const result = commandOutcomes(handle([cmd("b", "lost")], dismiss));
    result.dismiss("b");
    expect(dismiss).toHaveBeenCalledWith("b");
  });

  it("returns a safe no-op dismiss when the handle carries none", () => {
    const { dismiss } = commandOutcomes(handle([cmd("b", "overdue")]));
    expect(() => dismiss("b")).not.toThrow();
  });
});
