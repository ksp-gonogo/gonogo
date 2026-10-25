import type {
  SystemUplinkHealth,
  UplinkHealthEntry,
} from "@ksp-gonogo/sitrep-client";
import { describe, expect, it } from "vitest";
import { computeUplinkReadiness } from "../firstRun/useUplinkReadiness";
import type { UplinkLoadOutcome } from "./loaderState";
import { computeUplinkLoadFailures } from "./loadFailures";

function roster(
  entries: Array<Partial<UplinkHealthEntry> & { id: string }>,
  coreContract: SystemUplinkHealth["coreContract"] = { major: 15, minor: 0 },
): SystemUplinkHealth {
  return {
    coreContract,
    uplinks: entries.map((e) => ({
      id: e.id,
      name: e.name ?? null,
      version: e.version ?? "1.0.0",
      available: e.available ?? true,
      reason: e.reason ?? null,
      contract: e.contract ?? null,
      ownedPrefixes: [],
      modSettings: false,
      bundled: e.bundled ?? false,
      health: e.health ?? { state: "healthy", detail: null, facts: [] },
    })),
  };
}

function failures(
  entries: Array<Partial<UplinkHealthEntry> & { id: string }>,
  outcomes: UplinkLoadOutcome[] = [],
) {
  return computeUplinkLoadFailures(
    computeUplinkReadiness(roster(entries), outcomes),
  );
}

const quarantined = (
  patch: Partial<UplinkLoadOutcome> = {},
): UplinkLoadOutcome => ({
  id: "widget-a",
  name: "Widget A",
  status: "quarantined",
  reason: "bundle fetch failed: HTTP 404",
  ...patch,
});

describe("computeUplinkLoadFailures", () => {
  it("is empty when everything loaded", () => {
    expect(
      failures(
        [{ id: "widget-a" }],
        [{ id: "widget-a", name: "Widget A", status: "loaded" }],
      ),
    ).toEqual([]);
  });

  it("is empty before the mod has said anything", () => {
    expect(
      computeUplinkLoadFailures(computeUplinkReadiness(undefined, [])),
    ).toEqual([]);
  });

  it("names a contract refusal with both versions", () => {
    const [f] = failures([
      {
        id: "widget-a",
        name: "Widget A",
        available: false,
        reason: "major mismatch",
        contract: { major: 14, minor: 5 },
      },
    ]);
    expect(f).toMatchObject({
      id: "widget-a",
      name: "Widget A",
      kind: "contract",
    });
    expect(f.why).toMatch(/14\.5/);
    expect(f.why).toMatch(/15\.0/);
  });

  it("reports an assembly the game refused to start, with the mod's reason", () => {
    const [f] = failures([
      { id: "widget-a", available: false, reason: "missing dependency Foo" },
    ]);
    expect(f.kind).toBe("assembly");
    expect(f.why).toContain("missing dependency Foo");
  });

  it("reports a health-unavailable Uplink that is not bundled", () => {
    const [f] = failures([
      {
        id: "widget-a",
        health: { state: "unavailable", detail: "no save loaded", facts: [] },
      },
    ]);
    expect(f.kind).toBe("assembly");
    expect(f.why).toContain("no save loaded");
  });

  it("hides a bundled Uplink whose health is unavailable (expansion not owned)", () => {
    expect(
      failures([
        {
          id: "bundled-a",
          bundled: true,
          health: { state: "unavailable", detail: "DLC absent", facts: [] },
        },
      ]),
    ).toEqual([]);
  });

  it("hides a bundled Uplink whose client was refused on that same health", () => {
    expect(
      failures(
        [
          {
            id: "widget-a",
            bundled: true,
            health: { state: "unavailable", detail: "DLC absent", facts: [] },
          },
        ],
        [quarantined({ refusedOnHealth: true })],
      ),
    ).toEqual([]);
  });

  it("reports a bundled Uplink the mod refused outright", () => {
    const [f] = failures([
      {
        id: "widget-a",
        bundled: true,
        available: false,
        reason: "boom",
      },
    ]);
    expect(f.kind).toBe("assembly");
  });

  it("reports a quarantined client with the loader's reason", () => {
    const [f] = failures([{ id: "widget-a" }], [quarantined()]);
    expect(f.kind).toBe("client");
    expect(f.why).toContain("HTTP 404");
  });

  it("reports a bundled Uplink's failed client", () => {
    const [f] = failures(
      [{ id: "widget-a", bundled: true }],
      [quarantined({ reason: "load failed: boom" })],
    );
    expect(f.kind).toBe("client");
  });

  it("reports an integrity failure as such", () => {
    const [f] = failures(
      [{ id: "widget-a" }],
      [
        quarantined({
          integrity: {
            subject: "bundle",
            observed: "sha256-a",
            expected: "sha256-b",
            vouchedBy: ["installed-mod"],
          },
        }),
      ],
    );
    expect(f.kind).toBe("integrity");
  });

  it("does not count an Uplink the operator skipped", () => {
    expect(
      failures(
        [{ id: "widget-a" }],
        [quarantined({ skippedByOperator: true })],
      ),
    ).toEqual([]);
  });

  it("does not count a quarantine that says nothing about the Uplink", () => {
    expect(
      failures(
        [{ id: "widget-a" }],
        [quarantined({ registryUnavailable: true })],
      ),
    ).toEqual([]);
    expect(
      failures([{ id: "widget-a" }], [quarantined({ awaitingRoster: true })]),
    ).toEqual([]);
  });

  it("does not count an Uplink still loading", () => {
    expect(
      failures(
        [{ id: "widget-a" }],
        [{ id: "widget-a", name: "Widget A", status: "loading" }],
      ),
    ).toEqual([]);
  });

  it("does not count a client left over from an Uplink no longer installed", () => {
    expect(failures([], [quarantined()])).toEqual([]);
  });
});
