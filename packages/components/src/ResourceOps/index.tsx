import type { ActionDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  registerComponent,
  useActionInput,
  useTelemetry,
} from "@ksp-gonogo/core";
import type { Reading } from "@ksp-gonogo/sitrep-client";
import type {
  IsruConverterEntry,
  IsruDrillEntry,
  IsruResourceFlow,
} from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Card,
  Cluster,
  EmptyState,
  FilterList,
  type FilterRow,
  Grid,
  Inline,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  resourceColor,
  ScrollArea,
  Stack,
  Text,
  Truncate,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";
import { magnitudeOf, type Quantityish } from "../shared/magnitude";

/**
 * In-situ resource operations: every drill and every chemical converter on the
 * active vessel, at live rates.
 *
 * SOURCE-AGNOSTIC BY DESIGN, mod-side. `isru.*` is ONE Kernel-elected capability
 * publishing a single `isru.drills` / `isru.converters` pair, filled by whichever
 * backend won the election (stock, or a mod that replaces stock ISRU wholesale).
 * So this widget consumes ONE shape and renders identically whichever backend
 * answered. It never branches on which mod is installed, and it never imports a
 * provider's package.
 *
 * <b>The provider extension bag is deliberately not read here.</b> Each entry can
 * carry a provider-namespaced sub-tree (a blocking-reason string, an asteroid's
 * remaining mass, a process throttle), and reading it means importing the
 * provider's own typed accessor, which is exactly what a base widget must not do.
 * Every row below is complete from the shared fields alone, so there is no
 * empty-looking provider-shaped hole to explain on a stock install. Layering that
 * detail on is an augment's job, in the provider's own package.
 *
 * FILTERS ARE CONTRIBUTED, NEVER HARDCODED. The list is filtered by a mounted
 * `FilterList`, which owns its own `filters` contribution slot: a provider that
 * knows how these rows divide up (a mod's per-process axis) contributes
 * pre-filled SEARCH TERMS to that slot from its own Uplink, and they filter
 * against the `searchText` this widget bakes from its SHARED fields alone
 * (`partTitle`, kind, resource names). The widget holds no taxonomy: it could
 * not assert a life-support-versus-ISRU split even if it wanted to, and the
 * operator can always type a resource or part name into the same box.
 *
 * ACTIVE-VESSEL SCOPED: both channels capture off the active vessel only, the same
 * carry-gap `reliability.*` has. An empty list means this vessel has no drills or
 * converters, never that ISRU is untracked: stock genuinely models ISRU, so the
 * elected backend always has a real answer.
 *
 * LOCATION: neither `IsruDrillEntry` nor `IsruConverterEntry` carries a vessel or
 * body field, so a process can never say WHICH vessel it is on beyond the
 * active-vessel-scoped guarantee above. Since every entry on this stream is
 * necessarily the active vessel's, the header below answers "is this all in one
 * place, on a vessel, on Duna" honestly with data the shared shape already has
 * elsewhere: `vessel.identity` (name) resolved against `system.bodies`
 * (current body), both optional so a vanilla install with neither still renders
 * the list untouched. A genuine per-process location (e.g. a future multi-vessel
 * view) is NOT representable today; that needs a contract change adding a
 * `vesselId`/`vesselName` field to both entry types, mod-side.
 *
 * CURRENCY IS PER FIELD, AND EACH ENTRY CARRIES BOTH KINDS. What hardware is
 * bolted to the vessel is a fact: a drill does not leave the craft, a converter's
 * recipe is fixed at design time, and a deploy animation only moves when something
 * moves it. Those keep their last value, because no event that changes them can
 * reach us down a link that stopped delivering, and blanking them would erase a
 * rig that is demonstrably still bolted on. What each process is DOING is not a
 * fact of that kind: `running` stops on its own when a tank fills or the ore runs
 * out, and rates and ore abundance drift with load and location. So a channel that
 * goes stale keeps its cards and withholds every rate, abundance and run badge on
 * them, with the header naming which channel went, because a green "running" card
 * is a claim about the vessel now.
 */

type ResourceOpsConfig = Record<string, never>;

const resourceOpsActions = [
  {
    id: "next",
    label: "Next unit",
    accepts: ["button"],
    description:
      "Steps the highlighted drill or converter, so a hardware panel can walk the list and show one unit at a time.",
  },
] as const satisfies readonly ActionDefinition[];

export type ResourceOpsActions = typeof resourceOpsActions;

/** Resource | rate | flow-direction, shared by every process card's table. */
/**
 * The tombstone answer for both harvester lists: the producer saying "this vessel
 * has no drills" is an empty list, not a missing one. One shared frozen array so a
 * confirmed-none does not hand a fresh identity to `useMemo` every frame.
 */
const EMPTY_LIST: never[] = [];

const RESOURCE_TABLE_COLS = "minmax(0, 1fr) auto auto";
const RIGHT_ALIGN = { textAlign: "right" } as const;
/**
 * `Value`-equivalent typography for the resource-name cell, applied to
 * `Truncate` (which carries no size/tone props of its own). A long resource
 * name (`ElectricCharge`, `CarbonDioxide`) needs to ellipsize rather than
 * overflow into the rate column: the track alone (`minmax(0, 1fr)`) is not
 * enough, a grid item's own implicit `min-width: auto` still refuses to
 * shrink below its content unless the item itself carries `min-width: 0`,
 * which is exactly what `Truncate` sets (mirrors `FleetRoster`'s identical
 * fix on its own name column).
 */
const RESOURCE_NAME_STYLE = {
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-primary)",
} as const;

/**
 * Enough decimal places to show a rate as nonzero: `base` for an ordinary
 * magnitude, widened to two significant digits below it. Life-support rates
 * genuinely sit at 0.0002 units/s, and a fixed precision flattens that to
 * "0.000", which reads as a dead process rather than a slow one.
 */
/** Whether a reading went stale, as opposed to never having arrived. */
function notCurrent<T>(reading: Reading<T>): boolean {
  return reading.state === "stale";
}

/**
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
function stillTrue<T, A>(
  reading: Reading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "reckonable") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

function rateDecimals(rate: Quantityish, base: number): number {
  const magnitude = magnitudeOf(rate);
  if (magnitude === null || magnitude === 0) return base;
  const twoSignificant = 1 - Math.floor(Math.log10(Math.abs(magnitude)));
  return Math.min(6, Math.max(base, twoSignificant));
}

/**
 * Net ElectricCharge draw across every RUNNING converter (inputs minus
 * outputs), the one cheap power aggregate the shared shape supports: drills
 * carry no EC field of their own. `null` (not 0) when nothing on the vessel
 * touches ElectricCharge at all, so the header omits the stat rather than
 * claiming a known zero draw. A positive number draws power; negative means
 * the fleet is a net generator (e.g. a running fuel cell).
 */
function netElectricChargeDraw(
  converters: readonly IsruConverterEntry[],
): number | null {
  let touched = false;
  let net = 0;
  for (const converter of converters) {
    for (const flow of converter.inputs) {
      if (flow.resource !== "ElectricCharge") continue;
      touched = true;
      if (converter.running === true) net += magnitudeOf(flow.rate) ?? 0;
    }
    for (const flow of converter.outputs) {
      if (flow.resource !== "ElectricCharge") continue;
      touched = true;
      if (converter.running === true) net -= magnitudeOf(flow.rate) ?? 0;
    }
  }
  return touched ? net : null;
}

/**
 * One row of a process's resource table: resource name, its rate, and which
 * way it flows ("in" / "out" / "extract"). Returns a FRAGMENT of three flat
 * cells, not its own row wrapper: the enclosing `Grid` is what turns a run of
 * these into aligned columns across every row in the card (CSS grid
 * auto-flow), the same reason `Flows` used to render atomically.
 */
function ResourceCells({
  flow,
  direction,
  ratesNotCurrent,
}: Readonly<{
  flow: IsruResourceFlow;
  direction: "in" | "out" | "extract";
  /**
   * The rate went stale rather than never arriving, so the cell reads as
   * held-back rather than as "unknown", which the backend says when it has a
   * recipe but no figure for it. The resource name beside it stays: which
   * resource a process moves is a design fact.
   */
  ratesNotCurrent: boolean;
}>) {
  return (
    <>
      <Truncate style={RESOURCE_NAME_STYLE} title={flow.resource ?? undefined}>
        {flow.resource ?? "?"}
      </Truncate>
      <Text size="sm" tone="default" style={RIGHT_ALIGN}>
        {ratesNotCurrent ? (
          <Text tone="muted">{NULL_DISPLAY}</Text>
        ) : flow.rate !== null && flow.rate !== undefined ? (
          <Unit value={flow.rate} decimals={rateDecimals(flow.rate, 3)} />
        ) : (
          <Text tone="faint">unknown</Text>
        )}
      </Text>
      <ReadoutCaption style={RIGHT_ALIGN}>{direction}</ReadoutCaption>
    </>
  );
}

function DrillCard({
  drill,
  highlighted,
  notCurrent: drillNotCurrent,
}: Readonly<{
  drill: IsruDrillEntry;
  highlighted: boolean;
  /** The drill channel went stale: the rig is still there, its figures are not. */
  notCurrent: boolean;
}>) {
  return (
    <Card
      aria-current={highlighted ? "true" : undefined}
      // A `go` card is read as "extracting, right now". Held-back run state gets
      // the neutral tone instead of the last green one.
      tone={!drillNotCurrent && drill.running ? "go" : "default"}
      categoryColor={drill.resource ? resourceColor(drill.resource) : undefined}
    >
      <Stack gap="xs">
        {/* Wraps rather than clips: a no-wrap Cluster cut badges off at the
            default tile width. */}
        <Cluster justify="start" gap="xs" wrap>
          <Text size="sm" tone="default" weight="semibold">
            {drill.partTitle ?? drill.partId ?? "Drill"}
          </Text>
          {/* Deployed is genuinely absent on a harvester with no deploy
              animation, so the chip is omitted rather than shown as a false
              "retracted". */}
          {drill.deployed !== null && drill.deployed !== undefined && (
            <Badge severity={drill.deployed ? "nominal" : "info"}>
              {drill.deployed ? "deployed" : "retracted"}
            </Badge>
          )}
          {/* A harvester stops itself when its tank fills or the ore runs out, so
              "running" is a statement about now and is withheld rather than held
              over. The header says which channel it was withheld for. */}
          {drillNotCurrent ? (
            <Badge severity="info">run state held</Badge>
          ) : (
            <Badge severity={drill.running ? "nominal" : "info"}>
              {drill.running ? "running" : "stopped"}
            </Badge>
          )}
        </Cluster>
        <Grid cols={RESOURCE_TABLE_COLS} gap="sm" rowGap="xs" align="baseline">
          <ResourceCells
            flow={{ resource: drill.resource, rate: drill.rate }}
            direction="extract"
            ratesNotCurrent={drillNotCurrent}
          />
        </Grid>
        <Inline gap="xs">
          <ReadoutCaption>abundance</ReadoutCaption>
          {/* Ore abundance is a property of where the drill is standing, and the
              drill can be driven somewhere else while the link is down. */}
          {drillNotCurrent ? (
            <Text tone="muted">{NULL_DISPLAY}</Text>
          ) : drill.abundance !== null && drill.abundance !== undefined ? (
            <Unit value={drill.abundance} as="%" decimals={2} />
          ) : (
            <Text tone="faint">unknown</Text>
          )}
        </Inline>
      </Stack>
    </Card>
  );
}

function ConverterCard({
  converter,
  highlighted,
  notCurrent: converterNotCurrent,
}: Readonly<{
  converter: IsruConverterEntry;
  highlighted: boolean;
  /**
   * The converter channel went stale: the recipe still holds, the rates and the
   * run state do not, and the starved diagnostic derived from them cannot be
   * claimed either.
   */
  notCurrent: boolean;
}>) {
  // A converter that is on but moving nothing is a starved recipe. That is the
  // derived diagnostic the shared shape is meant to carry, rather than a string
  // no engine actually reports, so it is spelled out here rather than on the wire.
  // A process with NO outputs is exempt: a scrubber or waste processor consumes
  // and dumps by design, and an empty output side is its healthy state, not a
  // stall.
  //
  // A stall is diagnosed from rates and a run flag, so a stale record cannot
  // support it: the fault it names would be one the vessel had some seconds ago.
  const starved =
    !converterNotCurrent &&
    converter.running === true &&
    converter.outputs.length > 0 &&
    converter.outputs.every((flow) => (flow.rate?.magnitude ?? 0) === 0);

  // The card's identity colour: what it MAKES if it makes anything, else what
  // it consumes. Purely a "what kind of thing is this" mark (Card's top tab),
  // never a status signal, that's `tone` below.
  const primaryResource =
    converter.outputs[0]?.resource ?? converter.inputs[0]?.resource;

  return (
    <Card
      aria-current={highlighted ? "true" : undefined}
      tone={
        starved
          ? "warning"
          : !converterNotCurrent && converter.running
            ? "go"
            : "default"
      }
      categoryColor={
        primaryResource ? resourceColor(primaryResource) : undefined
      }
    >
      <Stack gap="xs">
        <Cluster justify="start" gap="xs" wrap>
          <Text size="sm" tone="default" weight="semibold">
            {converter.partTitle ?? converter.partId ?? "Converter"}
          </Text>
          {converterNotCurrent ? (
            <Badge severity="info">run state held</Badge>
          ) : (
            <Badge severity={converter.running ? "nominal" : "info"}>
              {converter.running ? "running" : "stopped"}
            </Badge>
          )}
          {starved && <Badge severity="warning">no output</Badge>}
        </Cluster>
        {/* The recipe table is the card's core content: every input then every
            output, one row each, columns aligned by the shared Grid template
            rather than the old wrapping inline runs. Either side can be
            genuinely empty (a scrubber has no output; a hypothetical pure
            generator would have no input), and reads as that fact via a
            "none" row rather than a blank gap in the table. */}
        <Grid cols={RESOURCE_TABLE_COLS} gap="sm" rowGap="xs" align="baseline">
          {converter.inputs.length > 0 ? (
            converter.inputs.map((flow, index) => (
              <ResourceCells
                key={`in-${flow.resource ?? index}`}
                flow={flow}
                direction="in"
                ratesNotCurrent={converterNotCurrent}
              />
            ))
          ) : (
            <Text tone="faint" size="sm">
              none
            </Text>
          )}
          {converter.outputs.length > 0 ? (
            converter.outputs.map((flow, index) => (
              <ResourceCells
                key={`out-${flow.resource ?? index}`}
                flow={flow}
                direction="out"
                ratesNotCurrent={converterNotCurrent}
              />
            ))
          ) : (
            // A consume-and-dump process (a scrubber) has no output side by
            // design: this reads as a fact, not a blank row.
            <Text tone="faint" size="sm">
              none
            </Text>
          )}
        </Grid>
      </Stack>
    </Card>
  );
}

/** The resources a converter touches, both recipe sides, as a searchable run. */
function converterResources(converter: IsruConverterEntry): string {
  return [...converter.inputs, ...converter.outputs]
    .map((flow) => flow.resource ?? "")
    .join(" ");
}

/**
 * Whole-widget summary: process count, how many are running, and any cheap
 * aggregate the shared shape supports (net EC draw), plus the vessel/body
 * this whole list is scoped to when that telemetry happens to be mounted.
 * Sits above the scrollable list so it stays visible while the cards scroll
 * underneath it.
 */
function ResourceOpsStats({
  total,
  activeCount,
  netEc,
  netEcNotCurrent,
  location,
  staleChannels,
}: Readonly<{
  total: number;
  /** Withheld (`undefined`) while either channel's run flags are stale. */
  activeCount: number | undefined;
  netEc: number | null;
  /** Whether `netEc` is a held figure rather than the vessel's current draw. */
  netEcNotCurrent: boolean;
  location: string | undefined;
  /** Which channels stopped being current, named for the operator. */
  staleChannels: readonly string[];
}>) {
  return (
    <Cluster
      justify="start"
      gap="lg"
      wrap
      role="group"
      aria-label="Resource ops summary"
    >
      <Inline gap="xs">
        <Text size="sm" tone="default" weight="semibold">
          {total}
        </Text>
        <ReadoutCaption>{total === 1 ? "process" : "processes"}</ReadoutCaption>
      </Inline>
      <Inline gap="xs">
        <Text size="sm" tone="default" weight="semibold">
          {activeCount ?? NULL_DISPLAY}
        </Text>
        <ReadoutCaption>active</ReadoutCaption>
      </Inline>
      {/* The stat stays mounted while the figure is withheld: WHETHER the vessel
          moves ElectricCharge is a property of the recipes, which is a fact, so
          dropping the row would say "nothing here draws power". */}
      {netEc !== null && (
        <Inline gap="xs">
          <ReadoutCaption>net EC</ReadoutCaption>
          {netEcNotCurrent ? (
            <Text tone="muted">{NULL_DISPLAY}</Text>
          ) : (
            <Unit
              value={value("units/s", netEc)}
              decimals={rateDecimals(netEc, 2)}
            />
          )}
        </Inline>
      )}
      {location && (
        <Inline gap="xs">
          <ReadoutCaption>at</ReadoutCaption>
          <Text size="sm" tone="default">
            {location}
          </Text>
        </Inline>
      )}
      {staleChannels.length > 0 && (
        <Text tone="warn" size="xs" role="status" aria-live="polite">
          {`Rates and run state no longer current: ${staleChannels.join(", ")}`}
        </Text>
      )}
    </Cluster>
  );
}

function ResourceOpsComponent(
  _props: Readonly<ComponentProps<ResourceOpsConfig>>,
) {
  /**
   * The roster of processes is a fact and stays drawn (see the class doc's
   * CURRENCY note), so these two reads keep their last list. Each channel carries
   * its own currency: a stale drill channel says nothing about the converters, and
   * hollowing out both because one went would withhold figures that are current.
   */
  const drillsReading = useTelemetry("isru.drills");
  const convertersReading = useTelemetry("isru.converters");
  const drillsNotCurrent = notCurrent(drillsReading);
  const convertersNotCurrent = notCurrent(convertersReading);

  const allDrills = useMemo(
    // A confirmed no-drills IS an empty list, not a wait, so it is named here
    // rather than left to the `??` below (which also has to cover pending).
    () => stillTrue(drillsReading, EMPTY_LIST) ?? EMPTY_LIST,
    [drillsReading],
  );
  const allConverters = useMemo(
    () => stillTrue(convertersReading, EMPTY_LIST) ?? EMPTY_LIST,
    [convertersReading],
  );
  const anything = allDrills.length + allConverters.length > 0;
  const staleChannels = [
    ...(drillsNotCurrent ? ["drills"] : []),
    ...(convertersNotCurrent ? ["converters"] : []),
  ];

  // Drills then converters, read end to end, so one "next" button walks the
  // whole vessel. The index is into this full order, not the currently-shown
  // subset: a hardware walk-through and an active text filter are not usually
  // driven at the same time, and the returned unit name stays correct either way.
  const total = allDrills.length + allConverters.length;
  const [highlighted, setHighlighted] = useState(0);
  const current = total > 0 ? highlighted % total : 0;

  useActionInput<ResourceOpsActions>({
    next: (payload) => {
      // Fire on the press edge only, so one tap steps one unit.
      if (payload.kind === "button" && payload.value !== true) return undefined;
      if (total === 0) return undefined;

      const nextIndex = (current + 1) % total;
      setHighlighted(nextIndex);

      const entry =
        nextIndex < allDrills.length
          ? allDrills[nextIndex]
          : allConverters[nextIndex - allDrills.length];
      return { unit: entry?.partTitle ?? entry?.partId ?? "unknown" };
    },
  });

  /**
   * How many processes are running right now, so it is withheld the moment either
   * side of the sum stops being current: "3 active" counted partly from held run
   * flags is a number with no moment attached to it.
   */
  const activeCount = useMemo(() => {
    if (drillsNotCurrent || convertersNotCurrent) return undefined;
    return (
      allDrills.filter((d) => d.running === true).length +
      allConverters.filter((c) => c.running === true).length
    );
  }, [allDrills, allConverters, drillsNotCurrent, convertersNotCurrent]);
  const netEc = useMemo(
    () => netElectricChargeDraw(allConverters),
    [allConverters],
  );

  // Optional, additive vessel/body context (see the class doc's LOCATION
  // note): both reads are `optionalChannels`, so a mount with neither still
  // renders the list untouched, just without this header line.
  //
  // Both are facts. A vessel's name and the body it is orbiting change on an
  // event (a rename, an SOI change), and the body table is the solar system
  // itself, so the last answer is still the answer and dropping "at Prospector
  // One · Duna" would lose a caption that is still true.
  const identity = stillTrue(useTelemetry("vessel.identity"), undefined);
  const systemBodies = stillTrue(useTelemetry("system.bodies"), undefined);
  const bodyName = useMemo(() => {
    if (identity?.parentBodyIndex == null) return undefined;
    return (systemBodies?.bodies ?? []).find(
      (b) => b.index === identity.parentBodyIndex,
    )?.name;
  }, [identity, systemBodies]);
  const location = identity?.name
    ? bodyName
      ? `${identity.name} · ${bodyName}`
      : identity.name
    : undefined;

  // The row list handed to FilterList. `searchText` is baked from the SHARED
  // fields only (part title, kind, resource names), which is the widget's whole
  // say over searchability: a contributed term (a mod's process title, itself
  // a substring of the shared part title) matches against this without the
  // widget ever reading a provider's extension bag.
  const rows = useMemo<FilterRow[]>(() => {
    const drillRows = allDrills.map((drill, index) => ({
      id: drill.partId ?? `drill-${index}`,
      searchText: `${drill.partTitle ?? drill.partId ?? "Drill"} drill ${
        drill.resource ?? ""
      }`,
      node: (
        <DrillCard
          drill={drill}
          highlighted={index === current}
          notCurrent={drillsNotCurrent}
        />
      ),
    }));
    const converterRows = allConverters.map((converter, index) => ({
      id: converter.partId ?? `converter-${index}`,
      searchText: `${
        converter.partTitle ?? converter.partId ?? "Converter"
      } converter ${converterResources(converter)}`,
      node: (
        <ConverterCard
          converter={converter}
          highlighted={allDrills.length + index === current}
          notCurrent={convertersNotCurrent}
        />
      ),
    }));
    return [...drillRows, ...converterRows];
  }, [
    allDrills,
    allConverters,
    current,
    drillsNotCurrent,
    convertersNotCurrent,
  ]);

  if (!anything) {
    return (
      <Panel panelTitle="RESOURCE OPS">
        {/* An empty list is a fact about the vessel, not a missing backend, so
            this says so rather than blaming the connection. */}
        <EmptyState layout="fill">
          No drills or converters on this vessel
        </EmptyState>
      </Panel>
    );
  }

  return (
    <Panel panelTitle="RESOURCE OPS">
      <ResourceOpsStats
        total={total}
        activeCount={activeCount}
        netEc={netEc}
        netEcNotCurrent={convertersNotCurrent}
        location={location}
        staleChannels={staleChannels}
      />
      <ScrollArea>
        <FilterList
          rows={rows}
          emptyLabel="Nothing on this vessel matches the filter"
        />
      </ScrollArea>
    </Panel>
  );
}

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<ResourceOpsConfig>({
  id: "resource-ops",
  name: "Resource Ops",
  description:
    "Every drill and chemical converter on the active vessel, grouped into cards: resource, live abundance and extraction rate, deploy and run state, and each converter's recipe as an aligned input/output table. A summary header shows process count, active count, and net EC draw. Renders identically whichever ISRU backend the mod elected.",
  tags: ["telemetry", "resources"],
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 3, h: 4 },
  component: ResourceOpsComponent,
  dataRequirements: ["isru.drills", "isru.converters"],
  // Additive vessel/body context for the header's "at" readout (see the
  // class doc's LOCATION note); the core drill/converter list works fully
  // without either, so these never gate the widget's mount.
  optionalChannels: ["vessel.identity", "system.bodies"],
  defaultConfig: {},
  actions: resourceOpsActions,
  pushable: true,
});

export { ResourceOpsComponent };
