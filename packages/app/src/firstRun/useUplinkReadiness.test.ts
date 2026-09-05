import type {
  SystemUplinkHealth,
  UplinkHealthEntry,
} from "@ksp-gonogo/sitrep-client";
import { describe, expect, it } from "vitest";
import type { UplinkLoadOutcome } from "../uplinks/loaderState";
import { computeUplinkReadiness } from "./useUplinkReadiness";

/*
 * Fixture ids are deliberately generic (never a real mod name): this file
 * exercises the join only, and a real mod-id literal here would trip the core
 * package's uplink-boundary ratchet for no reason.
 */

function roster(
  entries: Array<Partial<UplinkHealthEntry> & { id: string }>,
  coreContract: SystemUplinkHealth["coreContract"] = null,
): SystemUplinkHealth {
  return {
    coreContract,
    uplinks: entries.map((e) => ({
      id: e.id,
      version: e.version ?? "1.0.0",
      available: e.available ?? true,
      reason: e.reason ?? null,
      contract: e.contract ?? null,
      ownedPrefixes: e.ownedPrefixes ?? [],
      health: e.health ?? { state: "healthy", detail: null, facts: [] },
    })),
  };
}

describe("computeUplinkReadiness: the resolved states", () => {
  it("loaded: an outcome recorded loaded reads loaded", () => {
    const entries = computeUplinkReadiness(roster([{ id: "widget-a" }]), [
      { id: "widget-a", name: "Widget A", status: "loaded" },
    ]);
    expect(entries).toEqual([
      expect.objectContaining({
        id: "widget-a",
        name: "Widget A",
        state: "loaded",
        installed: true,
        modAvailable: true,
      }),
    ]);
  });

  it("loaded wins over the mod calling the same id unavailable", () => {
    const entries = computeUplinkReadiness(
      roster([{ id: "widget-a", available: false, reason: "flaky" }]),
      [{ id: "widget-a", name: "Widget A", status: "loaded" }],
    );
    expect(entries[0]?.state).toBe("loaded");
  });

  it("quarantined: a refused client carries the loader's own reason", () => {
    const outcome: UplinkLoadOutcome = {
      id: "widget-a",
      name: "Widget A",
      status: "quarantined",
      reason: "apiVersion incompatible: host 1.0.0, client built for 2.0.0",
    };
    const entries = computeUplinkReadiness(roster([{ id: "widget-a" }]), [
      outcome,
    ]);
    expect(entries[0]).toMatchObject({ state: "quarantined", outcome });
  });

  it("no-client: installed and available, but nothing was ever attempted", () => {
    const entries = computeUplinkReadiness(roster([{ id: "widget-a" }]), []);
    expect(entries[0]).toMatchObject({
      state: "no-client",
      outcome: null,
      installed: true,
    });
  });

  it("unavailable: the mod's own reason is carried verbatim", () => {
    const entries = computeUplinkReadiness(
      roster([
        { id: "widget-a", available: false, reason: "no antenna in range" },
      ]),
      [],
    );
    expect(entries[0]).toMatchObject({
      state: "unavailable",
      modAvailable: false,
      modReason: "no antenna in range",
    });
  });

  it("unavailable: never invents a reason the mod did not give", () => {
    const entries = computeUplinkReadiness(
      roster([{ id: "widget-a", available: false, reason: null }]),
      [],
    );
    expect(entries[0]).toMatchObject({
      state: "unavailable",
      modReason: null,
    });
  });

  it("contract-mismatch: a refused Uplink is a row, carrying both version numbers", () => {
    const entries = computeUplinkReadiness(
      roster(
        [
          {
            id: "widget-a",
            available: false,
            reason: "contract v14.5 vs core v15.0: major mismatch",
            contract: { major: 14, minor: 5 },
          },
        ],
        { major: 15, minor: 0 },
      ),
      [],
    );
    expect(entries[0]).toMatchObject({
      state: "contract-mismatch",
      modReason: "contract v14.5 vs core v15.0: major mismatch",
      declaredContract: { major: 14, minor: 5 },
      coreContract: { major: 15, minor: 0 },
    });
  });

  it("contract-mismatch outranks a client that loaded: the mod half never registered", () => {
    const entries = computeUplinkReadiness(
      roster(
        [
          {
            id: "widget-a",
            available: false,
            contract: { major: 14, minor: 5 },
          },
        ],
        { major: 15, minor: 0 },
      ),
      [{ id: "widget-a", name: "Widget A", status: "loaded" }],
    );
    expect(entries[0]?.state).toBe("contract-mismatch");
  });

  it("a MINOR difference is not a mismatch: minor bumps are additive and still talk", () => {
    const entries = computeUplinkReadiness(
      roster([{ id: "widget-a", contract: { major: 15, minor: 2 } }], {
        major: 15,
        minor: 7,
      }),
      [{ id: "widget-a", name: "Widget A", status: "loaded" }],
    );
    expect(entries[0]?.state).toBe("loaded");
  });

  it("an older mod reporting no versions reads as a plain unavailability, not a mismatch", () => {
    const entries = computeUplinkReadiness(
      roster([{ id: "widget-a", available: false, reason: "no antenna" }]),
      [],
    );
    expect(entries[0]?.state).toBe("unavailable");
  });

  it("loading: an in-flight attempt is its own state, not a missing client", () => {
    const entries = computeUplinkReadiness(roster([{ id: "widget-a" }]), [
      { id: "widget-a", name: "Widget A", status: "loading" },
    ]);
    expect(entries[0]?.state).toBe("loading");
  });
});

describe("computeUplinkReadiness: tri-state roster handling", () => {
  it("an unanswered roster contributes no rows", () => {
    expect(computeUplinkReadiness(undefined, [])).toEqual([]);
  });

  it("a tombstoned roster contributes no rows either", () => {
    expect(computeUplinkReadiness(null, [])).toEqual([]);
  });

  it("an unanswered roster never resolves a spurious unavailable for a loaded id", () => {
    const entries = computeUplinkReadiness(undefined, [
      { id: "widget-a", name: "Widget A", status: "loaded" },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.state).toBe("loaded");
  });
});

describe("computeUplinkReadiness: join-key edge cases", () => {
  it("keeps a row for a client that loaded but has dropped out of the roster", () => {
    const entries = computeUplinkReadiness(roster([{ id: "widget-a" }]), [
      { id: "ghost-widget", name: "Ghost Widget", status: "loaded" },
    ]);
    expect(entries.find((e) => e.id === "ghost-widget")).toMatchObject({
      state: "loaded",
      installed: false,
      modAvailable: false,
      modReason: null,
    });
  });

  it("names a row by its id when no outcome supplied one", () => {
    const entries = computeUplinkReadiness(roster([{ id: "widget-a" }]), []);
    expect(entries[0]?.name).toBe("widget-a");
  });

  it("prefers the roster's version, falling back to the outcome's", () => {
    const [installed] = computeUplinkReadiness(
      roster([{ id: "widget-a", version: "2.1.0" }]),
      [
        {
          id: "widget-a",
          name: "Widget A",
          version: "1.0.0",
          status: "loaded",
        },
      ],
    );
    expect(installed?.version).toBe("2.1.0");

    const [ghost] = computeUplinkReadiness(null, [
      { id: "ghost", name: "Ghost", version: "1.0.0", status: "loaded" },
    ]);
    expect(ghost?.version).toBe("1.0.0");
  });

  it("preserves roster order, appending outcome-only ids after", () => {
    const entries = computeUplinkReadiness(
      roster([{ id: "widget-b" }, { id: "widget-a" }]),
      [{ id: "ghost-widget", name: "Ghost Widget", status: "loaded" }],
    );
    expect(entries.map((e) => e.id)).toEqual([
      "widget-b",
      "widget-a",
      "ghost-widget",
    ]);
  });
});
