import {
  type ComponentDefinition,
  type ComponentProps,
  getComponents,
  PerfBudget,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  DERIVED_CHANNEL_IDS,
  getAllKnownTopicIds,
} from "@ksp-gonogo/sitrep-sdk";
import {
  type Capability,
  LockScopeContext,
  type LockScopeRegistry,
} from "@ksp-gonogo/sitrep-sdk/spine";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { listWidgets } from "../../scripts/widgets";
import "../index";
import { renderWidgetMode } from "./widgetDomSnapshot";

/**
 * A widget reads only the Topics it declares. `useTelemetry`, `useStream` and
 * `useCommand` each claim what they are given with the nearest lock scope, so a
 * scope mounted around the widget sees every Topic its tree reads, whatever
 * shared hook the read went through. What a widget leaves out of `channels` and
 * `optionalChannels` is not held by the dashboard when the save locks it, not
 * graded by the blackout badge and missing from its reference page.
 *
 * Not seen here: a processor's inputs and a reckoner's dependencies (they
 * subscribe without claiming), anything inside a nested `LockScope` such as a
 * `Section` or an augment slot (the nearest scope takes the claim), and a
 * branch no fixture renders.
 */

const FIXTURE_MODULES = import.meta.glob<{ default: Record<string, unknown> }>(
  "../*/__fixtures__/*.json",
  { eager: true },
);

/** What every `useCommand` handle reads for itself, so any widget that sends a command claims them. */
const COMMAND_PLUMBING: readonly string[] = [
  "system.uplink.pending",
  "system.uplink.gates",
  "comms.link",
  "comms.delay",
];

/**
 * Reads a widget makes that its declaration cannot express, each with the
 * reason. Shrink-only: an entry the widget no longer makes fails the gate, so
 * the list can only lose lines. `prefix` names a family of Topics with no
 * static id.
 */
interface Debt {
  widgetId: string;
  topic: string;
  prefix?: true;
  reason: string;
}

const DEBT: readonly Debt[] = [
  {
    widgetId: "system-view",
    topic: "silence.",
    prefix: true,
    reason:
      "one silence.<vesselId>.state per fleet vessel it draws, an id the manifest has no form for",
  },
];

/**
 * Families of Topics a widget reads that the manifest has no form for and the
 * fixtures never reach, so the gate cannot see them. Listed so they are not
 * forgotten: each wants a declaration form for dynamic Topics.
 */
const UNOBSERVED_DYNAMIC: readonly {
  widgetId: string;
  family: string;
  reason: string;
}[] = [
  {
    widgetId: "ship-map",
    family: "vessel.partActions.<flightId>",
    reason: "read only once a part's action menu is open",
  },
  {
    widgetId: "fleet-roster",
    family:
      "fleet.<vesselId>.contact, fleet.<vesselId>.delay, silence.<vesselId>.state",
    reason: "one set per fleet vessel row",
  },
  {
    widgetId: "map-view",
    family: "<domain>.available",
    reason: "one per registered map point-of-interest provider",
  },
  {
    widgetId: "graph",
    family: "any Topic the operator plots",
    reason: "series are chosen in the widget's configuration",
  },
  {
    widgetId: "maneuver-planner",
    family: "the dataKey of a configured trigger",
    reason: "triggers are authored by the operator",
  },
];

/** The Topic a flat requirement or field path reads: the longest known id it starts with. */
function topicOf(path: string, known: readonly string[]): string | undefined {
  return known
    .filter((id) => path === id || path.startsWith(`${id}.`))
    .sort((a, b) => b.length - a.length)[0];
}

function declaredTopics(
  def: Pick<
    ComponentDefinition,
    "channels" | "optionalChannels" | "dataRequirements"
  >,
  known: readonly string[],
): Set<string> {
  const declared = new Set<string>([
    ...(def.channels ?? []),
    ...(def.optionalChannels ?? []),
  ]);
  for (const requirement of def.dataRequirements ?? []) {
    const topic = topicOf(requirement, known);
    if (topic !== undefined) declared.add(topic);
  }
  return declared;
}

/** The claimed Topics that are neither declared nor command plumbing, nor named in `debt`. */
function undeclaredReads(
  claimed: ReadonlySet<Capability>,
  declared: ReadonlySet<string>,
  debt: readonly Debt[],
  widgetId: string,
): string[] {
  const topics = [...claimed]
    .filter((c) => c.kind === "topic")
    .map((c) => c.id);
  const sendsCommands = [...claimed].some((c) => c.kind === "command");
  const owed = debt.filter((d) => d.widgetId === widgetId);
  return [...new Set(topics)]
    .filter((id) => !declared.has(id))
    .filter((id) => !(sendsCommands && COMMAND_PLUMBING.includes(id)))
    .filter(
      (id) =>
        !owed.some((d) => (d.prefix ? id.startsWith(d.topic) : id === d.topic)),
    )
    .sort();
}

function recorder(): { scope: LockScopeRegistry; claimed: Set<Capability> } {
  const claimed = new Set<Capability>();
  return {
    claimed,
    scope: {
      claim(capability) {
        claimed.add(capability);
        return () => {};
      },
    },
  };
}

function scopeWrapper(scope: LockScopeRegistry) {
  return ({ children }: { children: ReactNode }) => (
    <LockScopeContext.Provider value={scope}>
      {children}
    </LockScopeContext.Provider>
  );
}

type WidgetProps = Parameters<typeof renderWidgetMode>[0]["Widget"];

/** The widget's claims across every fixture any of its render configs names, each at that config's largest mode. */
async function claimsOf(widgetId: string): Promise<Set<Capability>> {
  const def = getComponents().find((d) => d.id === widgetId);
  if (!def) throw new Error(`no registered widget ${widgetId}`);
  const { scope, claimed } = recorder();
  for (const config of listWidgets().filter((w) => w.widgetId === widgetId)) {
    const needle = `../${config.fixturesPath}/`;
    const fixtures = Object.entries(FIXTURE_MODULES)
      .filter(([path]) => path.startsWith(needle))
      .map(([, mod]) => mod.default);
    const mode = [...config.modes].sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? {
      name: "default",
      w: 12,
      h: 12,
    };
    for (const fixture of fixtures.length > 0 ? fixtures : [{}]) {
      const { teardown } = await renderWidgetMode({
        Widget: def.component as WidgetProps,
        fixture,
        mode,
        wrapper: scopeWrapper(scope),
      });
      teardown();
      // One widget mounted once per fixture back to back reads as a sustained rate to a budget that watches a live dashboard.
      for (const budget of PerfBudget.getAll()) budget.reset();
    }
  }
  return claimed;
}

const KNOWN = [...getAllKnownTopicIds(), ...DERIVED_CHANNEL_IDS];

describe("a widget reads only the Topics it declares", () => {
  it("sees a Topic a widget reads and does not declare", async () => {
    // Positive control: a gate that cannot see this reports zero, and zero reads as success.
    function Planted(_props: ComponentProps) {
      useTelemetry("vessel.control");
      return null;
    }
    const { scope, claimed } = recorder();
    const { teardown } = await renderWidgetMode({
      Widget: Planted,
      fixture: {},
      mode: { name: "planted", w: 4, h: 4 },
      wrapper: scopeWrapper(scope),
    });
    teardown();
    expect(
      undeclaredReads(claimed, new Set(["vessel.orbit"]), [], "planted"),
    ).toEqual(["vessel.control"]);
    expect(
      undeclaredReads(claimed, new Set(["vessel.control"]), [], "planted"),
    ).toEqual([]);
  });

  const widgetIds = [
    ...new Set(
      getComponents()
        .map((d) => d.id)
        .filter((id) => listWidgets().some((w) => w.widgetId === id)),
    ),
  ];

  it("mounts every registered widget", () => {
    const missing = getComponents()
      .map((d) => d.id)
      .filter((id) => !widgetIds.includes(id));
    expect(missing).toEqual([]);
  });

  it("names only registered widgets among the unobserved families", () => {
    const registered = new Set(getComponents().map((d) => d.id));
    expect(
      UNOBSERVED_DYNAMIC.filter((d) => !registered.has(d.widgetId)),
    ).toEqual([]);
  });

  it("covers a non-trivial number of widgets", () => {
    expect(widgetIds.length).toBeGreaterThan(25);
  });

  for (const widgetId of widgetIds) {
    it(`${widgetId} declares what it reads`, async () => {
      const def = getComponents().find((d) => d.id === widgetId);
      if (!def) throw new Error(widgetId);
      const claimed = await claimsOf(widgetId);
      expect(
        undeclaredReads(claimed, declaredTopics(def, KNOWN), DEBT, widgetId),
      ).toEqual([]);
    });
  }

  it("lists no debt a widget has paid off", async () => {
    const stale: string[] = [];
    for (const debt of DEBT) {
      const def = getComponents().find((d) => d.id === debt.widgetId);
      if (!def) {
        stale.push(`${debt.widgetId}: not a registered widget`);
        continue;
      }
      const claimed = await claimsOf(debt.widgetId);
      const still = undeclaredReads(
        claimed,
        declaredTopics(def, KNOWN),
        [],
        debt.widgetId,
      ).some((id) =>
        debt.prefix ? id.startsWith(debt.topic) : id === debt.topic,
      );
      if (!still) stale.push(`${debt.widgetId}: ${debt.topic}`);
    }
    expect(stale).toEqual([]);
  });
});
