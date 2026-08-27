import type { VesselTopology } from "@ksp-gonogo/core";
import {
  ContributionsProvider,
  DashboardItemContext,
  getComponents,
  type MockDataSource,
  registerStockBodies,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import type { Meta } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import type React from "react";
import { Fragment } from "react";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "./setupMockDataSource";
import { fixtureEmitsMuted, setupStreamFixture } from "./setupStreamFixture";
import {
  extractLegacyPartLiveFromFixture,
  topologyToVesselPartsWire,
} from "./topologyToVesselPartsWire";

/**
 * Fixtures authored before the `t.universalTime` client migration
 * (`useTelemetry("data", "t.universalTime")` → `useViewUt()`) still carry a
 * `"t.universalTime"` key: it's harmless to leave (widgets that don't read
 * it just ignore the emit), but a migrated widget's `useViewUt()` needs a
 * mounted `TelemetryProvider` to resolve to anything at all. Pin one from
 * the fixture's own value so these fixtures keep rendering exactly as they
 * did when the read came straight off the legacy `DataSource`, no
 * per-fixture/per-test opt-in needed. Fixtures with no such key are
 * unaffected (`pinnedUt` stays `undefined`, no `TelemetryProvider` mounted).
 */
function resolvePinnedUt(fixture: Fixture): number | undefined {
  const raw = fixture["t.universalTime"];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

/**
 * Same story as {@link resolvePinnedUt}, for the `v.topology`/`v.topologySeq`
 * retirement: `useTopology` (ShipMap/PowerSystems) now reads `vessel.parts`
 * canonically with NO legacy fallback at all, so a ShipMap/PowerSystems
 * fixture that still carries a `v.topology` payload (every existing fixture
 * does, captured before this migration) needs it reshaped onto the wire
 * shape and streamed through the SAME mounted `TelemetryProvider`, or the
 * "legacy" snapshot leg would render nothing but the "Waiting for vessel
 * topology..." empty state. Fixtures with no `v.topology` key are unaffected.
 *
 * Also overlays any `r.resourceFor[fid]`/`v.partState[fid]` legacy keys the
 * fixture carries: `usePartsLive`'s per-part `resources`/`partState` join
 * rides this SAME `vessel.parts` payload now (no more legacy `DataSource`
 * subscription), so a PowerSystems fixture with those keys (e.g.
 * `03-solar-charging-sunlight`) needs them folded in here or the "legacy"
 * leg would render an empty Producers/Consumers list instead of the
 * fixture's real PROD/NET numbers.
 */
function resolveVesselPartsWire(fixture: Fixture): unknown {
  const raw = fixture["v.topology"];
  if (!raw || typeof raw !== "object") return undefined;
  return topologyToVesselPartsWire(
    raw as VesselTopology,
    extractLegacyPartLiveFromFixture(fixture),
  );
}

/**
 * Same story as {@link resolvePinnedUt}/{@link resolveVesselPartsWire}, for the
 * `ActionGroup` canonical-read migration: that widget dropped its legacy
 * `useTelemetry("data", group.value)` shim entirely and now reads
 * `vessel.control` / `vessel.structure` one-arg, so a fixture carrying the old
 * `v.sasValue`/`v.ag1Value`/… keys needs them reshaped onto the wire or the
 * widget would render the null-display placeholder for every group instead
 * of the fixture's real state.
 *
 * Reshapes only the keys a fixture actually carries: an absent key stays absent
 * (`undefined`), which is the contract's own "not available this tick" and
 * exactly what the `unknown-state` fixture is asserting. Custom groups are
 * rebuilt as the NAMED list the mod now sends, sourced from whichever
 * `v.ag{n}Value` keys are present.
 */
function resolveVesselControlWire(fixture: Fixture): unknown {
  const bool = (key: string): boolean | undefined =>
    typeof fixture[key] === "boolean" ? (fixture[key] as boolean) : undefined;

  const actionGroups: { index: number; name: string; state: boolean }[] = [];
  for (let i = 1; i <= 10; i++) {
    const state = bool(`v.ag${i}Value`);
    if (state !== undefined) {
      actionGroups.push({ index: i, name: `AG${i}`, state });
    }
  }

  const control: Record<string, unknown> = {
    sas: bool("v.sasValue"),
    rcs: bool("v.rcsValue"),
    gear: bool("v.gearValue"),
    brakes: bool("v.brakeValue"),
    lights: bool("v.lightValue"),
    abort: bool("v.abortValue"),
    precisionControl: bool("v.precisionControlValue"),
    actionGroups: actionGroups.length > 0 ? actionGroups : undefined,
  };

  // Nothing this widget reads => no payload at all, so the provider isn't
  // mounted for fixtures that have nothing to say about control state.
  return Object.values(control).some((v) => v !== undefined)
    ? control
    : undefined;
}

/** `v.currentStage` -> `vessel.structure.currentStage`: ActionGroup's "Stage" group. */
function resolveVesselStructureWire(fixture: Fixture): unknown {
  const raw = fixture["v.currentStage"];
  return typeof raw === "number" ? { currentStage: raw } : undefined;
}

/**
 * `t.isPaused` -> `time.warp.paused`: the same story as
 * {@link resolveVesselControlWire}, for the OTHER canonical-read migration that
 * landed on these widgets: the pause/no-signal unavailability notices read
 * `time.warp` / `comms.link` one-arg now, with no legacy fallback, so a fixture
 * carrying the old keys must reshape them onto the wire or the notice silently
 * never renders. Absent key stays absent.
 */
function resolveTimeWarpWire(fixture: Fixture): unknown {
  const raw = fixture["t.isPaused"];
  return typeof raw === "boolean" ? { paused: raw } : undefined;
}

/** `comm.connected` -> `comms.link.connected`: see {@link resolveTimeWarpWire}. */
function resolveCommsLinkWire(fixture: Fixture): unknown {
  const raw = fixture["comm.connected"];
  return typeof raw === "boolean" ? { connected: raw } : undefined;
}

const fnum = (fixture: Fixture, key: string): number | undefined =>
  typeof fixture[key] === "number" ? (fixture[key] as number) : undefined;
const fbool = (fixture: Fixture, key: string): boolean =>
  (fnum(fixture, key) ?? 0) > 0.5;

/**
 * `sw.*` -> `kerbalism.spaceweather`: SpaceWeather dropped its legacy
 * `useDataSourceSubscription("data", "sw.*")` reads for the canonical
 * `useTelemetry("kerbalism.spaceweather")` Topic, so a fixture carrying the old
 * `sw.*` keys must reshape them onto the Topic wire or the board renders empty.
 * Radiation is stored rad/h in the fixture but the Topic (and real mod) is
 * rad/s, so it is divided by 3600 here, the widget multiplies it back for the
 * identical readout. Storm state 0/1/2 -> the incoming/inProgress bools.
 *
 * `sw.stars` / `sw.storms` / `sw.stormEjectionSpeed` pass through UNRESHAPED:
 * they are already the Topic's own shape (the sun-vantage half of the payload),
 * and a fixture carrying none simply leaves the star cards and CME tracker on
 * their empty states.
 */
function resolveKerbalismSpaceWeatherWire(fixture: Fixture): unknown {
  const hasSw = Object.keys(fixture).some((k) => k.startsWith("sw."));
  if (!hasSw) return undefined;
  const rph = fnum(fixture, "sw.radiationRadPerHour") ?? 0;
  const stormState = Math.round(fnum(fixture, "sw.stormState") ?? 0);
  return {
    radiationRadPerSecond: rph / 3600,
    habitatRadiationRadPerSecond: rph / 3600,
    magnetosphere: fbool(fixture, "sw.magnetosphere"),
    innerBelt: fbool(fixture, "sw.innerBelt"),
    outerBelt: fbool(fixture, "sw.outerBelt"),
    stormIncoming: stormState === 1,
    stormInProgress: stormState === 2,
    blackout: fbool(fixture, "sw.blackout"),
    inSunlight: true,
    shieldingAmount: fnum(fixture, "sw.shieldingValue") ?? 0,
    shieldingCapacity: fnum(fixture, "sw.shieldingCapacity") ?? 0,
    stars: fixture["sw.stars"] ?? [],
    storms: fixture["sw.storms"] ?? [],
    stormEjectionSpeed: fnum(fixture, "sw.stormEjectionSpeed"),
  };
}

/** `sw.altitudeM` -> `vessel.flight.altitudeAsl`: SpaceWeather's belt-ring vessel-dot placement. */
function resolveSpaceWeatherFlightWire(fixture: Fixture): unknown {
  const alt = fnum(fixture, "sw.altitudeM");
  return alt !== undefined
    ? { altitudeAsl: alt, altitudeTerrain: alt }
    : undefined;
}

/**
 * `ls.*` -> `kerbalism.lifesupport`: LifeSupportSystems dropped its legacy
 * `useDataSourceSubscription("data", "ls.*")` reads for the canonical
 * `useTelemetry("kerbalism.lifesupport")` Topic. Reshapes the flat consumable
 * (`ls.<res>.amount/capacity/rate`), habitat (`ls.pressure`/`ls.co2Poisoning`/…)
 * and process (`ls.process.<id>` 0=idle/1=running/2=broken) keys onto the Topic
 * payload the widget now reads.
 */
function resolveKerbalismLifeSupportWire(fixture: Fixture): unknown {
  const hasLs = Object.keys(fixture).some((k) => k.startsWith("ls."));
  if (!hasLs) return undefined;
  const proc = (id: string, resource: string, title: string) => {
    const state = Math.round(fnum(fixture, `ls.process.${id}`) ?? 0);
    return {
      resource,
      title,
      capacity: 1.67,
      running: state === 1,
      broken: state === 2,
    };
  };
  // `kerbalism.lifesupport` carries RATES only, keyed by resource name; the
  // levels ride the generic `vessel.resources` (see `lifeSupportLevels` below).
  // Absent means "no rate reported", so a fixture that names no consumables
  // emits an empty map rather than a map of zeros.
  const rates: Record<string, number> = {};
  for (const [name, prefix] of RESOURCE_FIXTURE_KEYS) {
    const rate = fnum(fixture, `${prefix}.rate`);
    if (rate !== null && rate !== undefined) rates[name] = rate;
  }
  return {
    rates,
    habitat: {
      pressure: fbool(fixture, "ls.pressure") ? 1 : 0,
      poisoning: fnum(fixture, "ls.co2Poisoning") ?? 0,
      shielding: 0,
      livingSpace: fnum(fixture, "ls.livingSpace") ?? 0,
      comfort: fnum(fixture, "ls.comfort") ?? 0,
      volume: 0,
      surface: 0,
    },
    processes: [
      proc("scrubber", "_Scrubber", "Scrubber"),
      proc("waterRecycler", "_WaterRecycler", "Water recycler"),
      proc("wasteProcessor", "_WasteProcessor", "Waste processor"),
      proc("fuelCell", "_MonopropFuelCell", "Fuel cell"),
    ],
  };
}

/**
 * KSP resource name -> the fixture prefix its levels/rate live under. The
 * fixtures predate the wire carrying resource names, so they still use short
 * keys (`ls.ec`); this is the one place the two vocabularies meet.
 */
const RESOURCE_FIXTURE_KEYS: ReadonlyArray<readonly [string, string]> = [
  ["Food", "ls.food"],
  ["Water", "ls.water"],
  ["Oxygen", "ls.oxygen"],
  ["ElectricCharge", "ls.ec"],
];

/**
 * The `vessel.resources` half of a life-support fixture: amounts and
 * capacities, which were never Kerbalism-specific and now ride the generic
 * name-keyed channel every consumer already has.
 */
function vesselResourcesFromLifeSupportFixture(
  fixture: Record<string, unknown>,
):
  | {
      resources: Record<
        string,
        { current: number; max: number; active: boolean }
      >;
    }
  | undefined {
  if (!Object.keys(fixture).some((k) => k.startsWith("ls."))) return undefined;
  const resources: Record<
    string,
    { current: number; max: number; active: boolean }
  > = {};
  for (const [name, prefix] of RESOURCE_FIXTURE_KEYS) {
    const current = fnum(fixture, `${prefix}.amount`);
    const max = fnum(fixture, `${prefix}.capacity`);
    if (current === null || current === undefined) continue;
    resources[name] = { current, max: max ?? 0, active: true };
  }
  return { resources };
}

/**
 * Per-mode size descriptor consumed by the snapshot helper. Mirrors the
 * `SizeMode` shape in `packages/components/scripts/widgets.ts` so the same
 * mode arrays drive both the playwright PNG renders and the vitest DOM
 * snapshots.
 */
export interface WidgetSnapshotMode {
  name: string;
  w: number;
  h: number;
  config?: Record<string, unknown>;
}

interface Fixture {
  _meta?: unknown;
  _stream?: StreamFixtureBlock;
  [key: string]: unknown;
}

/**
 * A fixture's own declaration of what it puts on the wire, and the ONLY
 * authority for a fixture that carries one.
 *
 * Structurally identical to the probe's `StreamFixtureBlock`
 * (`scripts/probe/probe-entry.tsx`), which is the point: one fixture format,
 * read the same way by both harnesses. Declared here rather than imported
 * because the probe entry is browser-bundled and pulls in a React root, a
 * registry install and a `createRoot` call that a vitest run has no business
 * loading; the shared thing is the fixture JSON, not the module.
 */
interface StreamFixtureBlock {
  /** Topics this fixture carries, forwarded to `setupStreamFixture`. */
  carriedChannels: string[];
  /** UT to pin the view clock at. */
  pinnedUt?: number;
  /** Fixed network/display delay in seconds. */
  delaySeconds?: number;
  /** Replayed in order, one `StubTransport.emit` per entry, post-mount. */
  emits: Array<{ channel: string; value: unknown; meta?: Partial<Meta> }>;
}

/** Extracts and narrows the optional `_stream` block off a fixture. */
function resolveStreamBlock(fixture: Fixture): StreamFixtureBlock | undefined {
  const raw = fixture._stream;
  if (!raw || typeof raw !== "object") return undefined;
  return Array.isArray(raw.emits) && Array.isArray(raw.carriedChannels)
    ? raw
    : undefined;
}

interface SnapshotOpts<Cfg> {
  /** Widget component to mount. */
  Widget: React.ComponentType<{
    config?: Cfg;
    id: string;
    w?: number;
    h?: number;
    onConfigChange?: (next: Cfg) => void;
  }>;
  /** Fixture object: every non-`_`-prefixed key is emitted to the data source. */
  fixture: Fixture;
  /** Grid mode (drives `w`/`h` props and optional per-mode config overlay). */
  mode: WidgetSnapshotMode;
  /** Override the instanceId used by `DashboardItemContext` (rarely needed). */
  instanceId?: string;
  /** Override the default config baseline (config overlay merges on top). */
  defaultConfig?: Cfg;
  /** Forwarded to `setupMockDataSource`: see its own doc comment. Default `false`, matching every existing widget's snapshot behavior. */
  connectSource?: boolean;
}

/**
 * The widget's own contribution stack, mirroring the app's `WidgetContributions`
 * (`GridItemContent.tsx`) and the shared render probe's `renderWidget`.
 *
 * Without it `useContributions` silently returns empty, and a widget whose
 * content comes through a contribution slot photographs as an empty frame while
 * the snapshot goes on claiming to cover it. That is not hypothetical: this
 * harness's own doc comment promises "the same mount path" as the probe, and it
 * had drifted off it. LandingStatus's descent envelope, whose every mark is a
 * self-contribution, is what surfaced it.
 *
 * The definition is found by matching the mounted COMPONENT against the
 * registry rather than by a new caller-supplied id, because an id every
 * snapshot file has to pass is an id somebody will forget, and the thing a
 * forgotten one produces is exactly the silent empty frame above. A component
 * that is not registered (a sub-component photographed directly) mounts
 * untouched.
 *
 * Exported because the drift is not the snapshot harness's alone. Any spec that
 * hand-rolls a `render(<Widget ... />)` mounts the same widget off the same
 * path, and once a widget's plots arrive through `plots` those specs go quiet
 * in exactly the same way: every query for a mark's accessible name fails, and
 * it reads like the widget stopped drawing rather than like the harness stopped
 * mounting the seam.
 */
export function WidgetContributions({
  Widget,
  children,
}: {
  Widget: unknown;
  children: React.ReactNode;
}) {
  const def = getComponents().find((d) => d.component === Widget);
  if (!def) return <>{children}</>;
  return (
    <WidgetMetaContext.Provider
      value={{
        componentId: def.id,
        contributionSlots: def.contributionSlots ?? [],
      }}
    >
      <ContributionsProvider>{children}</ContributionsProvider>
    </WidgetMetaContext.Provider>
  );
}

/** Built once per snapshot render; see {@link buildStreamWrap}. */
interface StreamWrap {
  /** Wraps `children` in the `TelemetryProvider` this fixture built, or renders them untouched when neither `pinnedUt` nor a `vessel.parts` payload is needed. */
  Wrap: (props: { children: React.ReactNode }) => React.ReactElement;
  /** `true` when a `TelemetryProvider` was actually mounted, drives {@link flushProviderFrame}. */
  providerMounted: boolean;
  /** Emits the fixture's `v.topology` (reshaped) onto `vessel.parts`, or a no-op when the fixture carries no `v.topology`. Call inside the same `act()` block as the other fixture-key emits. */
  emitVesselParts: () => void;
  /** Emits the fixture's legacy control keys (reshaped) onto `vessel.control`/`vessel.structure`, or a no-op when it carries none. Same `act()` block as the other emits. */
  emitVesselControl: () => void;
  /** Emits the fixture's `sw.*`/`ls.*` keys (reshaped) onto `kerbalism.spaceweather`/`kerbalism.lifesupport` (+ `vessel.orbit`), or a no-op when it carries none. Same `act()` block as the other emits. */
  emitKerbalism: () => void;
  /**
   * Replays the fixture's own `_stream.emits`, one topic at a time, each
   * gated on that topic having a live subscription. Awaited AFTER the
   * synchronous emit block rather than inside it, because the gating needs
   * frames to pass. A no-op for a fixture with no `_stream` block.
   */
  replayStreamBlock: () => Promise<void>;
}

/**
 * `StubTransport.emit` silently DROPS a sample for a topic nothing has
 * subscribed to yet, and a widget subscribes inside React *passive* effects
 * that no single flush is guaranteed to have run. Poll until the subscription
 * lands, exactly as the probe does, so the replay is deterministic instead of
 * a race the fixture loses on some runs. A topic the widget never reads simply
 * times out, and is then emitted-and-dropped, which is what the probe does too.
 */
async function waitForSubscription(
  transport: { isSubscribed(topic: string): boolean },
  topic: string,
  maxFrames = 30,
): Promise<void> {
  for (let i = 0; i < maxFrames; i++) {
    if (transport.isSubscribed(topic)) return;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
}

/**
 * Builds the minimal `TelemetryProvider` a legacy-fixture snapshot needs for
 * the two migrations that dropped their legacy fallback entirely:
 * `useViewUt()` (pinned at `pinnedUt`, see {@link resolvePinnedUt}) and
 * `useTopology()` (fed `vessel.parts`, see {@link resolveVesselPartsWire}).
 * Nothing else is carried, every other read stays on the legacy
 * `DataSource`. Returns a pass-through `Wrap` (no provider at all) when
 * neither is needed, matching every widget that touches neither key.
 */
function buildStreamWrap(fixture: Fixture): StreamWrap {
  // A fixture that declares its own wire wins outright, and the legacy
  // reshapes below are skipped entirely for it.
  //
  // This is the one place the two harnesses used to disagree about one file:
  // the playwright probe has honoured `_stream` since it was introduced, while
  // this one read only the flat legacy keys. A widget migrated to canonical
  // stream reads therefore rendered its EMPTY state here, and `toMatchSnapshot`
  // wrote that emptiness down as the expected result. The probe is the correct
  // reader of the format, so this follows it rather than the reverse.
  //
  // Deliberately exclusive rather than additive: a legacy reshape emitting onto
  // a channel the block already emits would overwrite the fixture's own,
  // more-complete payload with one derived from a handful of `v.*` mirrors, and
  // which of the two survived would come down to emit order.
  const streamBlock = resolveStreamBlock(fixture);
  if (streamBlock !== undefined) {
    const stream = setupStreamFixture({
      carriedChannels: streamBlock.carriedChannels,
      pinnedUt: streamBlock.pinnedUt ?? resolvePinnedUt(fixture),
      delaySeconds: streamBlock.delaySeconds,
    });
    return {
      Wrap: stream.Provider,
      providerMounted: true,
      emitVesselParts: () => {},
      emitVesselControl: () => {},
      emitKerbalism: () => {},
      replayStreamBlock: async () => {
        for (const e of streamBlock.emits) {
          await waitForSubscription(stream.transport, e.channel);
          stream.emit(e.channel, e.value, e.meta);
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve());
          });
        }
      },
    };
  }
  const pinnedUt = resolvePinnedUt(fixture);
  const vesselPartsWire = resolveVesselPartsWire(fixture);
  const vesselControlWire = resolveVesselControlWire(fixture);
  const vesselStructureWire = resolveVesselStructureWire(fixture);
  const timeWarpWire = resolveTimeWarpWire(fixture);
  const commsLinkWire = resolveCommsLinkWire(fixture);
  const kerbalismSpaceWeatherWire = resolveKerbalismSpaceWeatherWire(fixture);
  const spaceWeatherFlightWire = resolveSpaceWeatherFlightWire(fixture);
  const kerbalismLifeSupportWire = resolveKerbalismLifeSupportWire(fixture);
  const lifeSupportLevelsWire = vesselResourcesFromLifeSupportFixture(fixture);
  if (
    pinnedUt === undefined &&
    vesselPartsWire === undefined &&
    vesselControlWire === undefined &&
    vesselStructureWire === undefined &&
    timeWarpWire === undefined &&
    commsLinkWire === undefined &&
    kerbalismSpaceWeatherWire === undefined &&
    kerbalismLifeSupportWire === undefined
  ) {
    return {
      Wrap: ({ children }) => <Fragment>{children}</Fragment>,
      providerMounted: false,
      emitVesselParts: () => {},
      emitVesselControl: () => {},
      emitKerbalism: () => {},
      replayStreamBlock: async () => {},
    };
  }
  // `time.warp`/`comms.link` must be CARRIED, not merely emitted: the pause and
  // no-signal notices read them one-arg off the stream, and an uncarried channel
  // never reaches the widget. The other payloads here predate that distinction.
  const carriedChannels: string[] = [];
  if (timeWarpWire !== undefined) carriedChannels.push("time.warp");
  if (commsLinkWire !== undefined) carriedChannels.push("comms.link");
  const stream = setupStreamFixture({ carriedChannels, pinnedUt });
  return {
    Wrap: stream.Provider,
    providerMounted: true,
    emitVesselParts: () => {
      if (vesselPartsWire !== undefined) {
        stream.emit("vessel.parts", vesselPartsWire);
      }
    },
    emitVesselControl: () => {
      if (vesselControlWire !== undefined) {
        stream.emit("vessel.control", vesselControlWire);
      }
      if (vesselStructureWire !== undefined) {
        stream.emit("vessel.structure", vesselStructureWire);
      }
      if (timeWarpWire !== undefined) {
        stream.emit("time.warp", timeWarpWire);
      }
      if (commsLinkWire !== undefined) {
        stream.emit("comms.link", commsLinkWire);
      }
    },
    emitKerbalism: () => {
      if (kerbalismSpaceWeatherWire !== undefined) {
        stream.emit("kerbalism.spaceweather", kerbalismSpaceWeatherWire);
      }
      if (spaceWeatherFlightWire !== undefined) {
        stream.emit("vessel.flight", spaceWeatherFlightWire);
      }
      if (kerbalismLifeSupportWire !== undefined) {
        stream.emit("kerbalism.lifesupport", kerbalismLifeSupportWire);
      }
      // The levels half. Emitted alongside because a life-support fixture is
      // only meaningful with both: rates say which way each resource is going,
      // vessel.resources says how much is left.
      if (lifeSupportLevelsWire !== undefined) {
        stream.emit("vessel.resources", lifeSupportLevelsWire);
      }
    },
    replayStreamBlock: async () => {},
  };
}

/**
 * `useViewUt()`'s scrubbed value only lands via `ViewClock.onFrame`'s
 * `requestAnimationFrame` loop (its synchronous initial seed reads
 * `confirmedEdgeUt()`, which ignores `scrubTo` entirely: see that hook's
 * own doc comment in `sitrep-client/src/context.tsx`), and `useTopology`'s
 * canonical stream read similarly only lands via the `TelemetryProvider`'s
 * `beginFrame()` scheduling (a `requestAnimationFrame`, falling back to a
 * microtask under jsdom). Either way a plain `render()` + `act()` can commit
 * BEFORE the value has actually reached React state. Flush two rAF ticks
 * (wrapped in `act` so the resulting re-render doesn't warn) before reading
 * the DOM whenever a `TelemetryProvider` was mounted for this render, a
 * no-op when {@link StreamWrap.providerMounted} is `false`.
 */
async function flushProviderFrame(providerMounted: boolean): Promise<void> {
  if (!providerMounted) return;
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

/**
 * Caller's override, else the `defaultConfig` the widget registered, else
 * nothing.
 *
 * A widget whose behaviour depends on its registered default renders NOTHING
 * without one: ActionGroup answers "No action group configured" for every mode
 * that carries no config overlay, which is four of its eight, across all six
 * scenarios. The probe has always applied it (`payload.config ??
 * def.defaultConfig ?? {}` in probe-entry.tsx); this harness only ever used a
 * `defaultConfig` the CALLER passed, and almost no caller passes one.
 *
 * The answer is read straight from the registry rather than memoised by
 * component identity, because `setupMockDataSource` clears only the data
 * sources it owns and leaves the component registry standing.
 */
function baselineConfig<Cfg>(opts: SnapshotOpts<Cfg>): Cfg {
  if (opts.defaultConfig !== undefined) return opts.defaultConfig;
  const registered = getComponents().find(
    (def) => (def.component as unknown as object) === opts.Widget,
  )?.defaultConfig;
  return (registered as Cfg | undefined) ?? ({} as Cfg);
}

/**
 * Grid-unit to pixel conversion, the same arithmetic
 * `scripts/widgetRenderHarness.ts` sizes the playwright iframe with, so a mode
 * means the same shape in both harnesses.
 */
const COL_WIDTH = 32;
const ROW_HEIGHT = 25;
const GRID_MARGIN = 8;

function modePixels(mode: WidgetSnapshotMode): { w: number; h: number } {
  return {
    w: mode.w * COL_WIDTH + (mode.w - 1) * GRID_MARGIN,
    h: mode.h * ROW_HEIGHT + (mode.h - 1) * GRID_MARGIN,
  };
}

/**
 * Install a `ResizeObserver` that actually reports a size, for the length of
 * one render.
 *
 * The shared jsdom shim (`installDomStubs`) is a no-op in all three methods:
 * it exists to stop a mount crashing, and it never calls its callback. Any
 * widget that gates content on a measured box therefore renders that content
 * NEVER under this harness, whatever its fixture says. `Graph` is the big one
 * (`{size && <LineChart …>}`), and it is the whole body of six widgets: 90
 * committed baselines across KeplerPeriod and EscapeProfile were one
 * byte-identical title bar over two empty divs, repeated across every scenario
 * and every size, and the accessibility sweep was scanning those same blank
 * containers and reporting no violations.
 *
 * The reported box is the mode's own pixel size rather than a constant, so the
 * modes stay distinguishable and a size-gated branch is exercised at the size
 * it is gated on. It is the WIDGET's box, not the observed element's, which
 * overstates a chart area nested inside panel chrome; jsdom lays nothing out,
 * so there is no truer number available, and a chart drawn slightly large still
 * exercises the axis, label and ARIA code that a chart never drawn does not.
 *
 * Restored afterwards so a test file that renders something else is unaffected.
 * Already-constructed observers keep working, which is what the widget mounted
 * during this render needs.
 *
 * Exported for the same reason `WidgetContributions` is: a hand-rolled
 * `render(<Widget />)` in a widget's own spec hits the identical wall. A chart
 * in an unmeasured box renders `role="img" aria-label="Chart too small to
 * render"` and nothing else, so every assertion on a mark's accessible name
 * fails, and the transcript makes it look like the widget stopped drawing.
 */
export function installSizedResizeObserver(size: {
  w: number;
  h: number;
}): () => void {
  const previous = globalThis.ResizeObserver;
  class SizedResizeObserver {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element): void {
      // Asynchronous, like the real one: a synchronous callback would run
      // inside the observing effect and set state during render.
      setTimeout(() => {
        this.callback(
          [
            {
              target,
              contentRect: {
                width: size.w,
                height: size.h,
                x: 0,
                y: 0,
                top: 0,
                left: 0,
                right: size.w,
                bottom: size.h,
              } as DOMRectReadOnly,
            } as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        );
      }, 0);
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver =
    SizedResizeObserver as unknown as typeof ResizeObserver;
  return () => {
    globalThis.ResizeObserver = previous;
  };
}

/**
 * Let the sized-observer callbacks above land and the resulting re-render
 * commit. Two macrotask turns: the first drains the `setTimeout(0)` queue, the
 * second covers an observer a re-render only then attached (Graph re-binds its
 * observer when the chart/readout variant flips).
 */
export async function flushResizeObservers(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Mount a widget, emit every fixture key onto its data source, and return the
 * stripped innerHTML for snapshotting. Mirrors the playwright probe
 * (`scripts/probe/probe-entry.tsx`) at the DOM level, with the same mount path,
 * the same fixture seeding and the same modes, so vitest catches structural
 * regressions while the PNG harness covers the visual layer.
 *
 * The returned HTML has styled-components hashes and testing-library auto-ids
 * stripped so the snapshot is deterministic across runs. Canvas content,
 * ResizeObserver-driven layout and CSS-paint visuals do not appear: those live
 * in the playwright PNGs.
 */
export async function snapshotWidgetMode<
  Cfg extends Record<string, unknown> = Record<string, unknown>,
>(opts: SnapshotOpts<Cfg>): Promise<string> {
  // The probe registers stock bodies at module load; the DOM snapshot
  // does the same so body-aware widgets see resolved BodyDefinitions
  // for `Kerbin`, `Mun`, etc.
  registerStockBodies();
  const fixtureKeys = Object.keys(opts.fixture).filter(
    (k) => !k.startsWith("_"),
  );
  const fixture = await setupMockDataSource({
    id: "data",
    keys: fixtureKeys.map((key) => ({ key })),
    connectSource: opts.connectSource,
  });
  let source: MockDataSource | null = fixture.source;
  const restoreResizeObserver = installSizedResizeObserver(
    modePixels(opts.mode),
  );

  try {
    const config: Cfg = {
      ...baselineConfig(opts),
      ...((opts.mode.config ?? {}) as Cfg),
    };
    const instanceId = opts.instanceId ?? "snap";
    const {
      Wrap,
      providerMounted,
      emitVesselParts,
      emitVesselControl,
      emitKerbalism,
      replayStreamBlock,
    } = buildStreamWrap(opts.fixture);
    const { container } = render(
      <Wrap>
        <DashboardItemContext.Provider value={{ instanceId }}>
          <WidgetContributions Widget={opts.Widget}>
            <opts.Widget
              config={config}
              id={instanceId}
              w={opts.mode.w}
              h={opts.mode.h}
            />
          </WidgetContributions>
        </DashboardItemContext.Provider>
      </Wrap>,
    );

    // Seed every fixture key after mount so useDataValue subscriptions
    // exist before the emits, matches the probe's "mount, then emit"
    // ordering. Without the act() wrapper React batches updates and the
    // snapshot races the commit.
    act(() => {
      if (!fixtureEmitsMuted()) {
        for (const key of fixtureKeys) {
          source?.emit(key, opts.fixture[key]);
        }
      }
      emitVesselParts();
      emitVesselControl();
      emitKerbalism();
    });
    // Outside the synchronous block above: each entry waits for its topic's
    // subscription, which only lands once frames have run.
    await act(async () => {
      await replayStreamBlock();
    });
    await flushProviderFrame(providerMounted);

    // Drain the async `useDataSeries` backfill (graphs/sparklines) before
    // snapshotting. waitFor wraps act, so the backfill's notify() flushes
    // inside it: no manual act(). Waits on the real pending work, not a
    // bare tick. No-op for widgets that never query a range.
    await waitFor(() => {
      if (fixture.pendingQueries() !== 0) throw new Error("backfill pending");
    });
    await flushResizeObservers();

    return stripVolatile(container.innerHTML);
  } finally {
    restoreResizeObserver();
    teardownMockDataSource(fixture);
    source = null;
  }
}

/** Live render handle from {@link renderWidgetMode}. */
export interface RenderedWidget {
  /** The mounted, still-live container: valid until `teardown()`. */
  container: HTMLElement;
  /**
   * Unmount and disconnect. Must be called by the test (typically right
   * after assertions). Runs `cleanup()` before the data-source disconnect
   * so no state update fires outside `act()`.
   */
  teardown: () => void;
}

/**
 * Mount a widget exactly like {@link snapshotWidgetMode}, same registry,
 * same fixture seeding, same context: but leave it mounted and return the
 * live `container` plus a `teardown()`, for callers that need to assert on
 * the rendered DOM (e.g. running `axe()` for an a11y smoke). Unlike
 * `snapshotWidgetMode`, teardown is the caller's responsibility: run your
 * assertions against `container` first, then call `teardown()`.
 */
export async function renderWidgetMode<
  Cfg extends Record<string, unknown> = Record<string, unknown>,
>(opts: SnapshotOpts<Cfg>): Promise<RenderedWidget> {
  registerStockBodies();
  const fixtureKeys = Object.keys(opts.fixture).filter(
    (k) => !k.startsWith("_"),
  );
  const fixture = await setupMockDataSource({
    id: "data",
    keys: fixtureKeys.map((key) => ({ key })),
    connectSource: opts.connectSource,
  });
  const source: MockDataSource = fixture.source;
  const restoreResizeObserver = installSizedResizeObserver(
    modePixels(opts.mode),
  );

  const config: Cfg = {
    ...baselineConfig(opts),
    ...((opts.mode.config ?? {}) as Cfg),
  };
  const instanceId = opts.instanceId ?? "snap";
  const {
    Wrap,
    providerMounted,
    emitVesselParts,
    emitVesselControl,
    emitKerbalism,
    replayStreamBlock,
  } = buildStreamWrap(opts.fixture);
  const { container } = render(
    <Wrap>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <WidgetContributions Widget={opts.Widget}>
          <opts.Widget
            config={config}
            id={instanceId}
            w={opts.mode.w}
            h={opts.mode.h}
          />
        </WidgetContributions>
      </DashboardItemContext.Provider>
    </Wrap>,
  );

  act(() => {
    if (!fixtureEmitsMuted()) {
      for (const key of fixtureKeys) {
        source.emit(key, opts.fixture[key]);
      }
    }
    emitVesselParts();
    emitVesselControl();
    // Was missing here while `snapshotWidgetMode` called it, so a Kerbalism
    // fixture's a11y render was a blank board even when its snapshot was fed.
    emitKerbalism();
  });
  await act(async () => {
    await replayStreamBlock();
  });
  await flushProviderFrame(providerMounted);

  // Drain the async useDataSeries backfill the testing-library way (see
  // snapshotWidgetMode) so a11y assertions run against a settled tree.
  await waitFor(() => {
    if (fixture.pendingQueries() !== 0) throw new Error("backfill pending");
  });
  await flushResizeObservers();
  restoreResizeObserver();

  return { container, teardown: () => teardownMockDataSource(fixture) };
}

/**
 * Strip styled-components hashes, testing-library auto-ids, and any `sc-*`
 * class or id attribute that changes per build. Without this the snapshot
 * churns on every styled-components release and file edit.
 *
 * Exported beyond this file's own two internal callers for
 * `WarpControl/dual-run.test.tsx`'s render golden: comparing two renders needs
 * exactly the same stripping, so a genuine markup difference is not masked by
 * two builds' differing volatile-class churn.
 */
export function stripVolatile(html: string): string {
  return html
    .replace(/\sclass="[^"]*\bsc-[^"]*"/g, "")
    .replace(/\sid="[^"]*\bsc-[^"]*"/g, "")
    .replace(/\sdata-testid="[^"]+"/g, "")
    .replace(/\sdata-sc[a-z-]*="[^"]*"/g, "");
}

/**
 * Rewrite React `useId` values (`:r3:`) to their order of first appearance
 * (`:rid0:`). The counter is per-root and advances for every hook that ran
 * before ours, so mounting an extra provider alongside the widget shifts every
 * id in the tree without changing a thing about its behaviour, which is exactly
 * what a dual-run comparison must not trip on.
 *
 * Deliberately a mapping and not a blanket replace: collapsing every id to one
 * token would also hide a real defect, an `aria-controls` pointing at the wrong
 * panel. Renumbering keeps each reference matching the element it names, so a
 * tablist wired to the wrong panel still fails the compare.
 *
 * NOT folded into `stripVolatile`, which the committed DOM snapshots also run
 * through: doing that rewrites ids in every stored snapshot, and a snapshot is
 * compared against its own past self rather than a second mount, so it never had
 * the counter-shift problem this solves.
 */
export function normaliseReactIds(html: string): string {
  const seen = new Map<string, string>();
  return html.replace(/:r[0-9a-z]+:/g, (id) => {
    const existing = seen.get(id);
    if (existing !== undefined) return existing;
    const token = `:rid${seen.size}:`;
    seen.set(id, token);
    return token;
  });
}
