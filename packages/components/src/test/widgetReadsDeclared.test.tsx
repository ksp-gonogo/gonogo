import {
  type ComponentDefinition,
  type ComponentProps,
  getComponents,
  PerfBudget,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useCommand, useStream } from "@ksp-gonogo/sitrep-client";
import {
  type ChannelFamily,
  DERIVED_CHANNEL_IDS,
  getAllKnownTopicIds,
  topicMatchesFamily,
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
 * The runtime recorder: what a widget really reads, set against what it
 * declares. `useTelemetry`, `useStream` and `useCommand` each claim what they
 * are given with the nearest lock scope, so a scope mounted around the widget
 * sees every Topic its tree reads, whatever shared hook the read went through.
 * What a widget leaves out of `channels`, `optionalChannels` and the family
 * lists is not held by the dashboard when the save locks it, not graded by the
 * blackout badge and missing from its reference page.
 *
 * `uplink-tools check` writes those declarations from the source, so a read
 * missing here means the scanner missed it. This test is what validates the
 * scanner against reality: it also sees the real id behind a family pattern and
 * the Topics a widget's `channelsFromConfig` names under a fixture's settings.
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
 * Commands a widget declares that no fixture reaches, each with the reason.
 * Shrink-only: an entry a fixture now reaches fails the gate, so the list can
 * only lose lines.
 */
const UNREACHED_COMMANDS: readonly {
  widgetId: string;
  command: string;
  reason: string;
}[] = [
  {
    widgetId: "action-group",
    command: "vessel.control.setAbort",
    reason:
      "sent only for the named group of that kind, which no fixture's configuration holds",
  },
  {
    widgetId: "action-group",
    command: "vessel.control.setBrakes",
    reason:
      "sent only for the named group of that kind, which no fixture's configuration holds",
  },
  {
    widgetId: "action-group",
    command: "vessel.control.setGear",
    reason:
      "sent only for the named group of that kind, which no fixture's configuration holds",
  },
  {
    widgetId: "action-group",
    command: "vessel.control.setLights",
    reason:
      "sent only for the named group of that kind, which no fixture's configuration holds",
  },
  {
    widgetId: "action-group",
    command: "vessel.control.setRcs",
    reason:
      "sent only for the named group of that kind, which no fixture's configuration holds",
  },
  {
    widgetId: "action-group",
    command: "vessel.control.setSas",
    reason:
      "sent only for the named group of that kind, which no fixture's configuration holds",
  },
  {
    widgetId: "action-group",
    command: "vessel.control.stage",
    reason:
      "sent only for the Stage group, which no fixture's configuration holds",
  },
];

/**
 * Families a widget declares or reads that no fixture reaches, so the recorder
 * cannot see them. Shrink-only: an entry whose pattern the widget declares and
 * a fixture now claims is stale.
 */
const UNOBSERVED_FAMILIES: readonly {
  widgetId: string;
  pattern: string;
  reason: string;
}[] = [
  {
    widgetId: "ship-map",
    pattern: "vessel.partActions.<flightId>",
    reason: "read only once a part's action menu is open",
  },
  {
    widgetId: "map-view",
    pattern: "<domain>.available",
    reason: "one per registered map point-of-interest provider",
  },
  {
    widgetId: "maneuver-planner",
    pattern: "<trigger dataKey>",
    reason:
      "armed triggers are runtime state of the trigger service, read outside any hook",
  },
];

/** The Topic a flat requirement or field path reads: the longest known id it starts with. */
function topicOf(path: string, known: readonly string[]): string | undefined {
  return known
    .filter((id) => path === id || path.startsWith(`${id}.`))
    .sort((a, b) => b.length - a.length)[0];
}

interface Declared {
  topics: Set<string>;
  families: ChannelFamily[];
}

function declaredTopics(
  def: Pick<
    ComponentDefinition,
    | "channels"
    | "optionalChannels"
    | "channelFamilies"
    | "optionalChannelFamilies"
    | "dataRequirements"
  >,
  known: readonly string[],
  fromConfig: readonly string[] = [],
): Declared {
  const topics = new Set<string>([
    ...(def.channels ?? []),
    ...(def.optionalChannels ?? []),
    ...fromConfig,
  ]);
  for (const requirement of def.dataRequirements ?? []) {
    const topic = topicOf(requirement, known);
    if (topic !== undefined) topics.add(topic);
  }
  return {
    topics,
    families: [
      ...(def.channelFamilies ?? []),
      ...(def.optionalChannelFamilies ?? []),
    ],
  };
}

const isMember = (id: string, families: readonly ChannelFamily[]) =>
  families.some((family) => topicMatchesFamily(id, family));

/** The claimed Topics that are neither declared nor command plumbing, nor named in `debt`. */
function undeclaredReads(
  claimed: ReadonlySet<Capability>,
  declared: Declared,
  debt: readonly Debt[],
  widgetId: string,
): string[] {
  const topics = [...claimed]
    .filter((c) => c.kind === "topic")
    .map((c) => c.id);
  const sendsCommands = [...claimed].some((c) => c.kind === "command");
  const owed = debt.filter((d) => d.widgetId === widgetId);
  return [...new Set(topics)]
    .filter((id) => !declared.topics.has(id))
    .filter((id) => !isMember(id, declared.families))
    .filter((id) => !(sendsCommands && COMMAND_PLUMBING.includes(id)))
    .filter(
      (id) =>
        !owed.some((d) => (d.prefix ? id.startsWith(d.topic) : id === d.topic)),
    )
    .sort();
}

/** The declared family patterns no claimed id is a member of. */
function unclaimedFamilies(
  claimed: ReadonlySet<Capability>,
  declared: Declared,
): ChannelFamily[] {
  const ids = [...claimed].filter((c) => c.kind === "topic").map((c) => c.id);
  return declared.families.filter(
    (family) => !ids.some((id) => topicMatchesFamily(id, family)),
  );
}

/** The claimed commands the widget does not list in `commands`. */
function undeclaredCommands(
  claimed: ReadonlySet<Capability>,
  declared: ReadonlySet<string>,
): string[] {
  return [
    ...new Set(
      [...claimed].filter((c) => c.kind === "command").map((c) => c.id),
    ),
  ]
    .filter((id) => id !== "" && !declared.has(id))
    .sort();
}

/** The listed commands no claim names, other than those in `unreached`. */
function unclaimedCommands(
  claimed: ReadonlySet<Capability>,
  declared: ReadonlySet<string>,
  unreached: ReadonlySet<string>,
): string[] {
  const sent = new Set(
    [...claimed].filter((c) => c.kind === "command").map((c) => c.id),
  );
  return [...declared]
    .filter((id) => !sent.has(id) && !unreached.has(id))
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
      observe(capability) {
        claimed.add(capability);
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

interface Claims {
  claimed: Set<Capability>;
  /** What `channelsFromConfig` names for each config the widget was rendered under. */
  fromConfig: Set<string>;
}

/**
 * The widget's claims across every fixture any of its render configs names,
 * each at that config's largest mode. A widget whose reads follow its tile
 * settings is also rendered under each distinct mode config, since the Topics it
 * reads differ between them.
 */
async function claimsOf(widgetId: string): Promise<Claims> {
  const def = getComponents().find((d) => d.id === widgetId);
  if (!def) throw new Error(`no registered widget ${widgetId}`);
  const { scope, claimed } = recorder();
  const fromConfig = new Set<string>();
  for (const config of listWidgets().filter((w) => w.widgetId === widgetId)) {
    const needle = `../${config.fixturesPath}/`;
    const fixtures = Object.entries(FIXTURE_MODULES)
      .filter(([path]) => path.startsWith(needle))
      .map(([, mod]) => mod.default);
    const bySize = [...config.modes].sort((a, b) => b.w * b.h - a.w * a.h);
    const modes = def.channelsFromConfig
      ? bySize.filter(
          (mode, i) =>
            bySize.findIndex(
              (other) =>
                JSON.stringify(other.config) === JSON.stringify(mode.config),
            ) === i,
        )
      : bySize.slice(0, 1);
    for (const mode of modes.length > 0
      ? modes
      : [{ name: "default", w: 12, h: 12 }]) {
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
      const settings = {
        ...(def.defaultConfig ?? {}),
        ...((mode as { config?: object }).config ?? {}),
      };
      for (const id of def.channelsFromConfig?.(settings as never) ?? []) {
        fromConfig.add(id);
      }
    }
  }
  return { claimed, fromConfig };
}

const claimCache = new Map<string, Promise<Claims>>();

function claimsOnce(widgetId: string): Promise<Claims> {
  const cached = claimCache.get(widgetId);
  if (cached) return cached;
  const claims = claimsOf(widgetId);
  claimCache.set(widgetId, claims);
  return claims;
}

const KNOWN = [...getAllKnownTopicIds(), ...DERIVED_CHANNEL_IDS];

const noFamilies = { topics: new Set<string>(), families: [] };

describe("a widget reads only the Topics it declares", () => {
  async function plantedClaims(
    Widget: (props: ComponentProps) => null,
  ): Promise<Set<Capability>> {
    const { scope, claimed } = recorder();
    const { teardown } = await renderWidgetMode({
      Widget,
      fixture: {},
      mode: { name: "planted", w: 4, h: 4 },
      wrapper: scopeWrapper(scope),
    });
    teardown();
    return claimed;
  }

  it("sees a Topic a widget reads and does not declare", async () => {
    // Positive control: a gate that cannot see this reports zero, and zero reads as success.
    const claimed = await plantedClaims(function Planted(_p: ComponentProps) {
      useTelemetry("vessel.control");
      return null;
    });
    const declares = (id: string) => ({ ...noFamilies, topics: new Set([id]) });
    expect(
      undeclaredReads(claimed, declares("vessel.orbit"), [], "planted"),
    ).toEqual(["vessel.control"]);
    expect(
      undeclaredReads(claimed, declares("vessel.control"), [], "planted"),
    ).toEqual([]);
  });

  it("sees a family member a widget reads, and the family nothing reads", async () => {
    const claimed = await plantedClaims(function PlantedFamily(
      _p: ComponentProps,
    ) {
      useStream("fleet.abc.contact");
      return null;
    });
    const wrong = {
      ...noFamilies,
      families: ["fleet.<vessel>.delay" as ChannelFamily],
    };
    const right = {
      ...noFamilies,
      families: ["fleet.<vessel>.contact" as ChannelFamily],
    };
    expect(undeclaredReads(claimed, wrong, [], "planted")).toEqual([
      "fleet.abc.contact",
    ]);
    expect(unclaimedFamilies(claimed, wrong)).toEqual(["fleet.<vessel>.delay"]);
    expect(undeclaredReads(claimed, right, [], "planted")).toEqual([]);
    expect(unclaimedFamilies(claimed, right)).toEqual([]);
  });

  it("sees a config-derived Topic only when the settings name it", async () => {
    const claimed = await plantedClaims(function PlantedConfig(
      _p: ComponentProps,
    ) {
      useTelemetry("vessel.flight");
      return null;
    });
    const def = { channelsFromConfig: () => ["vessel.flight"] };
    expect(
      undeclaredReads(
        claimed,
        declaredTopics({}, KNOWN, def.channelsFromConfig()),
        [],
        "planted",
      ),
    ).toEqual([]);
    expect(
      undeclaredReads(claimed, declaredTopics({}, KNOWN, []), [], "planted"),
    ).toEqual(["vessel.flight"]);
  });

  it("sees a command a widget sends and does not declare, and one it declares and never sends", async () => {
    function Planted(_props: ComponentProps) {
      useCommand("time.setPaused");
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
    expect(undeclaredCommands(claimed, new Set(["time.setWarpIndex"]))).toEqual(
      ["time.setPaused"],
    );
    expect(undeclaredCommands(claimed, new Set(["time.setPaused"]))).toEqual(
      [],
    );
    expect(
      unclaimedCommands(
        claimed,
        new Set(["time.setPaused", "time.setWarpIndex"]),
        new Set(),
      ),
    ).toEqual(["time.setWarpIndex"]);
    expect(
      unclaimedCommands(
        claimed,
        new Set(["time.setPaused", "time.setWarpIndex"]),
        new Set(["time.setWarpIndex"]),
      ),
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
      UNOBSERVED_FAMILIES.filter((d) => !registered.has(d.widgetId)),
    ).toEqual([]);
  });

  it("covers a non-trivial number of widgets", () => {
    expect(widgetIds.length).toBeGreaterThan(25);
  });

  for (const widgetId of widgetIds) {
    it(`${widgetId} declares what it reads`, async () => {
      const def = getComponents().find((d) => d.id === widgetId);
      if (!def) throw new Error(widgetId);
      const { claimed, fromConfig } = await claimsOnce(widgetId);
      const declared = declaredTopics(def, KNOWN, [...fromConfig]);
      expect(undeclaredReads(claimed, declared, DEBT, widgetId)).toEqual([]);
      const listed = UNOBSERVED_FAMILIES.filter(
        (d) => d.widgetId === widgetId,
      ).map((d) => d.pattern);
      expect(
        unclaimedFamilies(claimed, declared).filter(
          (family) => !listed.includes(family),
        ),
      ).toEqual([]);
    });
  }

  for (const widgetId of widgetIds) {
    it(`${widgetId} declares the commands it sends`, async () => {
      const def = getComponents().find((d) => d.id === widgetId);
      if (!def) throw new Error(widgetId);
      const { claimed } = await claimsOnce(widgetId);
      const declared = new Set<string>(def.commands ?? []);
      const unreached = new Set(
        UNREACHED_COMMANDS.filter((u) => u.widgetId === widgetId).map(
          (u) => u.command,
        ),
      );
      expect({
        undeclared: undeclaredCommands(claimed, declared),
        neverSent: unclaimedCommands(claimed, declared, unreached),
      }).toEqual({ undeclared: [], neverSent: [] });
    });
  }

  it("lists no unreached command a fixture now sends", async () => {
    const stale: string[] = [];
    for (const entry of UNREACHED_COMMANDS) {
      const def = getComponents().find((d) => d.id === entry.widgetId);
      if (!def) {
        stale.push(`${entry.widgetId}: not a registered widget`);
        continue;
      }
      const { claimed } = await claimsOnce(entry.widgetId);
      const sent = [...claimed].some(
        (c) => c.kind === "command" && c.id === entry.command,
      );
      if (sent || !(def.commands ?? []).includes(entry.command as never)) {
        stale.push(`${entry.widgetId}: ${entry.command}`);
      }
    }
    expect(stale).toEqual([]);
  });

  it("lists no unobserved family a fixture now reaches", async () => {
    const stale: string[] = [];
    for (const entry of UNOBSERVED_FAMILIES) {
      const def = getComponents().find((d) => d.id === entry.widgetId);
      const pattern = entry.pattern as ChannelFamily;
      const declares = [
        ...(def?.channelFamilies ?? []),
        ...(def?.optionalChannelFamilies ?? []),
      ].includes(pattern);
      if (!def || !declares) continue;
      const { claimed } = await claimsOnce(entry.widgetId);
      if (
        !unclaimedFamilies(claimed, declaredTopics(def, KNOWN)).includes(
          pattern,
        )
      ) {
        stale.push(`${entry.widgetId}: ${entry.pattern}`);
      }
    }
    expect(stale).toEqual([]);
  });

  it("renders every config-derived widget under settings that name a Topic", async () => {
    // A Graph plots from fixture series the scope never sees, so the recorder proves only that the settings reach channelsFromConfig, not that each named Topic is read.
    const unreached: string[] = [];
    for (const def of getComponents().filter((d) => d.channelsFromConfig)) {
      if (!widgetIds.includes(def.id)) continue;
      const { fromConfig } = await claimsOnce(def.id);
      if (fromConfig.size === 0) unreached.push(def.id);
    }
    expect(unreached).toEqual([]);
  });

  it("lists no debt a widget has paid off", async () => {
    const stale: string[] = [];
    for (const debt of DEBT) {
      const def = getComponents().find((d) => d.id === debt.widgetId);
      if (!def) {
        stale.push(`${debt.widgetId}: not a registered widget`);
        continue;
      }
      const { claimed, fromConfig } = await claimsOnce(debt.widgetId);
      const still = undeclaredReads(
        claimed,
        declaredTopics(def, KNOWN, [...fromConfig]),
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
