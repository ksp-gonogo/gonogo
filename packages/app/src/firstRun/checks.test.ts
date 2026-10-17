import type { UplinkHealthStateName } from "@ksp-gonogo/sitrep-client";
import { describe, expect, it } from "vitest";
import {
  connectionCheck,
  isThisComputer,
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
    bundled: false,
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

  it("reads a retrying socket that has gone unanswered as a failure that says it is still trying", () => {
    expect(connectionCheck("reconnecting", "localhost:8090", true)).toEqual({
      state: "fail",
      text: say("connect.check.retrying", { address: "localhost:8090" }),
    });
    expect(connectionCheck("connected", "localhost:8090", true).state).toBe(
      "pass",
    );
  });

  it("passes when connected and fails otherwise, naming the address", () => {
    expect(connectionCheck("connected", "192.0.2.5:8090")).toEqual({
      state: "pass",
      text: say("connect.check.pass", { address: "192.0.2.5:8090" }),
    });
    for (const status of ["disconnected", "error", undefined] as const)
      expect(connectionCheck(status, "localhost:8090")).toEqual({
        state: "fail",
        text: say("connect.check.fail", { address: "localhost:8090" }),
      });
  });
});

describe("uplinksCheck", () => {
  it("says the mod cannot list its Uplinks when the connection has failed, rather than waiting on it", () => {
    const failed = { state: "fail", text: "x" } as const;
    expect(uplinksCheck({ entries: [], waitingForMod: true }, failed)).toEqual({
      state: "fail",
      text: say("uplinks.check.noConnection"),
      derived: true,
    });
    expect(
      uplinksCheck(
        { entries: [], waitingForMod: true },
        { state: "checking", text: "x" },
      ).state,
    ).toBe("checking");
  });

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

describe("uplinksCheck: Uplinks the operator skipped", () => {
  it("passes, naming the skip, when the only unloaded Uplinks were skipped", () => {
    const entries = [
      entry({}),
      entry({ id: "a", state: "skipped" }),
      entry({ id: "b", state: "skipped" }),
    ];
    expect(uplinksCheck({ entries, waitingForMod: false })).toEqual({
      state: "pass",
      text: say("uplinks.check.skipped", { installed: 3, skipped: 2 }),
    });
  });

  it("still asks for attention when a real failure sits beside a skip", () => {
    const entries = [
      entry({ id: "a", state: "skipped" }),
      entry({ id: "b", state: "quarantined" }),
    ];
    expect(uplinksCheck({ entries, waitingForMod: false })).toEqual({
      state: "attention",
      text: say("uplinks.check.attention", { installed: 2, attention: 1 }),
    });
  });
});

describe("uplinksCheck: Uplinks that ship no client", () => {
  it("counts a mod-only Uplink as installed but never as needing attention", () => {
    const entries = [
      entry({ id: "a", state: "loaded" }),
      entry({ id: "b", state: "mod-only" }),
      entry({ id: "c", state: "mod-only" }),
    ];
    expect(uplinksCheck({ entries, waitingForMod: false })).toEqual({
      state: "pass",
      text: say("uplinks.check.allWorking", { installed: 3 }),
    });
  });
});

describe("isThisComputer", () => {
  it("is true for the names that mean this computer", () => {
    for (const host of [
      "localhost",
      "LOCALHOST",
      "127.0.0.1",
      "127.1.2.3",
      "::1",
      "[::1]",
    ]) {
      expect(isThisComputer(host), host).toBe(true);
    }
  });

  it("is false for an address on the network", () => {
    for (const host of [
      "192.0.2.20",
      "192.0.2.4",
      "deck.local",
      "1270.0.0.1",
    ]) {
      expect(isThisComputer(host), host).toBe(false);
    }
  });
});

describe("uplinksCheck: Uplinks inside the core mod", () => {
  it("leaves them out of the count, so one add-on reads as one", () => {
    const check = uplinksCheck({
      entries: [
        entry({ id: "addon" }),
        entry({ id: "core-a", bundled: true, state: "mod-only" }),
        entry({ id: "core-b", bundled: true, state: "mod-only" }),
      ],
      waitingForMod: false,
    });
    expect(check).toEqual({
      state: "pass",
      text: say("uplinks.check.allWorking", { installed: 1 }),
    });
  });

  it("reads as none when the mod lists only its own, and never flags one that is unavailable", () => {
    const unavailable = entry({
      id: "makingHistory",
      bundled: true,
      state: "unavailable",
      health: "unavailable",
    });
    expect(needsAttention(unavailable)).toBe(false);
    expect(
      uplinksCheck({ entries: [unavailable], waitingForMod: false }),
    ).toEqual({ state: "pass", text: say("uplinks.check.none") });
  });
});
