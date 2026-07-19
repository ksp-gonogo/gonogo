import type {
  SystemUplinkHealth,
  UplinkHealthEntry,
} from "@ksp-gonogo/sitrep-client";
import { describe, expect, it } from "vitest";
import type { RegistryIndex, UplinkDescriptor } from "../uplinks/registry";
import { computeUplinkGap } from "./useUplinkGap";

// Fixture ids are deliberately generic (never a real mod name) — this file
// exercises the join logic only, and a real mod-id literal here would trip
// the core package's uplink-boundary ratchet for no reason (this module has
// no coupling to any specific Uplink).

function roster(
  entries: Array<Partial<UplinkHealthEntry> & { id: string }>,
): SystemUplinkHealth {
  return {
    uplinks: entries.map((e) => ({
      id: e.id,
      version: e.version ?? "1.0.0",
      available: e.available ?? true,
      reason: e.reason ?? null,
      health: e.health ?? { state: "healthy", detail: null },
    })),
  };
}

function registry(
  descriptors: Array<Partial<UplinkDescriptor> & { id: string }>,
): RegistryIndex {
  return {
    uplinks: descriptors.map((d) => ({
      id: d.id,
      name: d.name ?? d.id,
      author: d.author ?? "tester",
      repo: d.repo ?? "example/repo",
      versions: d.versions ?? [],
    })),
  };
}

describe("computeUplinkGap — the four (+one) resolved states", () => {
  it("loaded: an id in loadedIds resolves 'loaded' regardless of roster/hub", () => {
    const entries = computeUplinkGap(
      roster([{ id: "widget-a", available: true }]),
      ["widget-a"],
      registry([{ id: "widget-a" }]),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "widget-a",
      state: "loaded",
      loaded: true,
      installed: true,
      modAvailable: true,
    });
  });

  it("loaded wins even when the mod roster reports the same id unavailable", () => {
    const entries = computeUplinkGap(
      roster([{ id: "widget-a", available: false, reason: "flaky" }]),
      ["widget-a"],
      null,
    );
    expect(entries[0]?.state).toBe("loaded");
  });

  it("load-from-hub: not loaded, mod available, hub has a descriptor", () => {
    const entries = computeUplinkGap(
      roster([{ id: "widget-a", available: true }]),
      [],
      registry([{ id: "widget-a", name: "Widget A" }]),
    );
    expect(entries[0]).toMatchObject({
      id: "widget-a",
      name: "Widget A",
      state: "load-from-hub",
      loaded: false,
      installed: true,
      modAvailable: true,
      hubDescriptor: expect.objectContaining({ id: "widget-a" }),
    });
  });

  it("installed-no-client: not loaded, mod available, hub index fetched successfully but has no descriptor for it", () => {
    const entries = computeUplinkGap(
      roster([{ id: "widget-a", available: true }]),
      [],
      registry([{ id: "some-other-widget" }]), // a real, successful, non-empty index
    );
    expect(entries[0]).toMatchObject({
      id: "widget-a",
      state: "installed-no-client",
      hubDescriptor: null,
    });
  });

  it("installed-no-client: also resolves when the hub index is successfully fetched but empty", () => {
    const entries = computeUplinkGap(
      roster([{ id: "widget-a", available: true }]),
      [],
      registry([]),
    );
    expect(entries[0]?.state).toBe("installed-no-client");
  });

  it("unavailable: mod roster says not-available, surfaces roster.reason verbatim", () => {
    const entries = computeUplinkGap(
      roster([
        { id: "widget-a", available: false, reason: "no antenna in range" },
      ]),
      [],
      registry([{ id: "widget-a" }]),
    );
    expect(entries[0]).toMatchObject({
      id: "widget-a",
      state: "unavailable",
      modAvailable: false,
      modReason: "no antenna in range",
    });
  });

  it("unavailable: never rewords a null reason into a synthesized string", () => {
    const entries = computeUplinkGap(
      roster([{ id: "widget-a", available: false, reason: null }]),
      [],
      null,
    );
    expect(entries[0]).toMatchObject({
      state: "unavailable",
      modReason: null,
    });
  });

  it("hub-unknown: mod available, not loaded, but the hub fetch failed (hubIndex null) — never conflated with installed-no-client", () => {
    const entries = computeUplinkGap(
      roster([{ id: "widget-a", available: true }]),
      [],
      null,
    );
    expect(entries[0]).toMatchObject({
      id: "widget-a",
      state: "hub-unknown",
      hubDescriptor: null,
    });
    // Distinct from the "confirmed no descriptor" case, which requires a
    // real (non-null) index — same roster input, different hubIndex, must
    // resolve to a DIFFERENT state.
    const confirmed = computeUplinkGap(
      roster([{ id: "widget-a", available: true }]),
      [],
      registry([]),
    );
    expect(confirmed[0]?.state).toBe("installed-no-client");
  });
});

describe("computeUplinkGap — tri-state roster handling", () => {
  it("roster undefined ('still waiting') contributes zero roster-derived entries", () => {
    const entries = computeUplinkGap(
      undefined,
      [],
      registry([{ id: "widget-a" }]),
    );
    expect(entries).toEqual([]);
  });

  it("roster undefined never resolves a spurious 'unavailable' for a loaded id", () => {
    const entries = computeUplinkGap(undefined, ["widget-a"], null);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.state).toBe("loaded");
  });

  it("roster null ('confirmed no mod talking') also contributes zero roster-derived entries", () => {
    const entries = computeUplinkGap(null, [], registry([{ id: "widget-a" }]));
    expect(entries).toEqual([]);
  });

  it("undefined and null both join identically at the pure-function level (only the hook distinguishes them)", () => {
    const withUndefined = computeUplinkGap(undefined, ["widget-a"], null);
    const withNull = computeUplinkGap(null, ["widget-a"], null);
    expect(withUndefined).toEqual(withNull);
  });
});

describe("computeUplinkGap — join-key edge cases", () => {
  it("an id present in the roster but absent from the hub manifest resolves installed-no-client, not silently dropped", () => {
    const entries = computeUplinkGap(
      roster([{ id: "widget-a", available: true }]),
      [],
      registry([{ id: "widget-b" }]),
    );
    expect(entries.map((e) => e.id)).toEqual(["widget-a"]);
    expect(entries[0]?.state).toBe("installed-no-client");
  });

  it("an id present in the hub manifest but absent from both the roster and loadedIds produces NO row (v1 scope: hub-only entries are out of scope, design §3 step 6)", () => {
    const entries = computeUplinkGap(
      roster([{ id: "widget-a", available: true }]),
      [],
      registry([{ id: "widget-a" }, { id: "hub-only-widget" }]),
    );
    expect(entries.map((e) => e.id)).toEqual(["widget-a"]);
  });

  it("an id that is loaded but no longer present in the roster still produces a row, marked installed: false", () => {
    const entries = computeUplinkGap(
      roster([{ id: "widget-a", available: true }]), // roster has moved on
      ["ghost-widget"], // still loaded from an earlier session
      registry([{ id: "ghost-widget", name: "Ghost Widget" }]),
    );
    const ghost = entries.find((e) => e.id === "ghost-widget");
    expect(ghost).toMatchObject({
      state: "loaded",
      loaded: true,
      installed: false,
      modAvailable: false,
      modReason: null,
      name: "Ghost Widget",
    });
  });

  it("name falls back to the id when the hub has no descriptor for it", () => {
    const entries = computeUplinkGap(
      roster([{ id: "widget-a", available: true }]),
      [],
      registry([]),
    );
    expect(entries[0]?.name).toBe("widget-a");
  });

  it("preserves roster order, appending loaded-only ids after", () => {
    const entries = computeUplinkGap(
      roster([
        { id: "widget-b", available: true },
        { id: "widget-a", available: true },
      ]),
      ["ghost-widget"],
      null,
    );
    expect(entries.map((e) => e.id)).toEqual([
      "widget-b",
      "widget-a",
      "ghost-widget",
    ]);
  });
});
