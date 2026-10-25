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
      health: e.health ?? {
        state: "healthy",
        detail: null,
        facts: [],
        preventsStart: false,
      },
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

  it("does not count an Uplink that loaded but reports its own health unavailable", () => {
    expect(
      failures([
        {
          id: "widget-a",
          health: {
            state: "unavailable",
            detail: "host mod absent",
            facts: [],
            preventsStart: false,
          },
        },
      ]),
    ).toEqual([]);
  });

  it("does not count a bundled Uplink whose expansion is not owned", () => {
    expect(
      failures(
        [
          {
            id: "bundled-a",
            bundled: true,
            health: {
              state: "unavailable",
              detail: "DLC absent",
              facts: [],
              preventsStart: false,
            },
          },
        ],
        [quarantined({ id: "bundled-a", refusedOnHealth: true })],
      ),
    ).toEqual([]);
  });

  it("reports an Uplink that says its own state prevents start, in its own words", () => {
    const [f] = failures([
      {
        id: "widget-a",
        health: {
          state: "unavailable",
          detail: "Install the partner mod, then restart KSP",
          facts: [],
          preventsStart: true,
        },
      },
    ]);
    expect(f.kind).toBe("reported");
    expect(f.why).toBe("Install the partner mod, then restart KSP");
  });

  it("reports a tagged Uplink whatever state it reads", () => {
    const [f] = failures([
      {
        id: "widget-a",
        health: {
          state: "healthy",
          detail: null,
          facts: [],
          preventsStart: true,
        },
      },
    ]);
    expect(f.kind).toBe("reported");
    expect(f.why).toBe("It blocks start and gave no reason.");
    expect(f.fix).toBeNull();
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
