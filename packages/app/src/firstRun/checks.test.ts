import type { UplinkHealthStateName } from "@ksp-gonogo/sitrep-client";
import { describe, expect, it } from "vitest";
import {
  connectionCheck,
  needsAttention,
  relayCheck,
  uplinksCheck,
} from "./checks";
import { say } from "./copy";
import type { UplinkReadinessEntry } from "./useUplinkReadiness";

function entry(
  overrides: Partial<UplinkReadinessEntry> & { health?: UplinkHealthStateName },
): UplinkReadinessEntry {
  const { health = "healthy", ...rest } = overrides;
  return {
    id: "terminal",
    name: "terminal",
    version: "1.0.0",
    installed: true,
    modAvailable: true,
    modReason: null,
    declaredContract: null,
    coreContract: null,
    rosterEntry: {
      id: "terminal",
      name: null,
      version: "1.0.0",
      available: true,
      reason: null,
      contract: null,
      ownedPrefixes: [],
      modSettings: false,
      health: { state: health, detail: null, facts: [] },
    },
    outcome: null,
    state: "loaded",
    ...rest,
  };
}

describe("relayCheck", () => {
  it("passes only on an answer, and names the address it asked on a failure", () => {
    expect(relayCheck("checking").state).toBe("checking");
    expect(relayCheck("ok")).toEqual({
      state: "pass",
      text: say("container.check.pass"),
    });
    expect(relayCheck("unreachable")).toEqual({
      state: "fail",
      text: say("container.check.fail", { url: "http://localhost:3002" }),
    });
  });
});

describe("connectionCheck", () => {
  it("reads a retrying socket as still checking, since aimed correctly with KSP closed is not a fault yet", () => {
    expect(connectionCheck("reconnecting", "localhost:8090").state).toBe(
      "checking",
    );
  });

  it("passes when connected and fails otherwise, naming the address", () => {
    expect(connectionCheck("connected", "10.0.0.5:8090")).toEqual({
      state: "pass",
      text: say("connect.check.pass", { address: "10.0.0.5:8090" }),
    });
    for (const status of ["disconnected", "error", undefined] as const)
      expect(connectionCheck(status, "localhost:8090")).toEqual({
        state: "fail",
        text: say("connect.check.fail", { address: "localhost:8090" }),
      });
  });
});

describe("uplinksCheck", () => {
  it("waits for the mod rather than guessing", () => {
    expect(uplinksCheck({ entries: [], waitingForMod: true }).state).toBe(
      "checking",
    );
  });

  it("passes with no Uplinks at all, because none is required", () => {
    expect(uplinksCheck({ entries: [], waitingForMod: false })).toEqual({
      state: "pass",
      text: say("uplinks.check.none"),
    });
  });

  it("passes when every installed Uplink is working, degraded included", () => {
    const degraded = entry({ id: "mapper", health: "degraded" });
    expect(needsAttention(degraded)).toBe(false);
    expect(
      uplinksCheck({ entries: [entry({}), degraded], waitingForMod: false }),
    ).toEqual({
      state: "pass",
      text: say("uplinks.check.allWorking", { installed: 2 }),
    });
  });

  it("asks for attention, never failure, when an Uplink is not working", () => {
    const entries = [
      entry({}),
      entry({ id: "a", state: "quarantined" }),
      entry({ id: "b", state: "no-client" }),
      entry({ id: "c", health: "unavailable" }),
      // A client left over from an earlier session is not installed now, so it is not counted.
      entry({
        id: "d",
        installed: false,
        rosterEntry: null,
        state: "quarantined",
      }),
    ];
    expect(uplinksCheck({ entries, waitingForMod: false })).toEqual({
      state: "attention",
      text: say("uplinks.check.attention", { installed: 4, attention: 3 }),
    });
    expect(
      uplinksCheck({
        entries: [entry({ state: "contract-mismatch" })],
        waitingForMod: false,
      }).text,
    ).toBe(say("uplinks.check.attention", { installed: 1, attention: 1 }));
  });
});
