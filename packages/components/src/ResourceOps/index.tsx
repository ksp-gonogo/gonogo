import type { ActionDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  registerComponent,
  useActionInput,
} from "@ksp-gonogo/core";

import type {
  IsruConverterEntry,
  IsruDrillEntry,
  IsruResourceFlow,
} from "@ksp-gonogo/sitrep-sdk";
import { hasAnswered, stillTrue, value } from "@ksp-gonogo/sitrep-sdk";
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
  Section,
  Stack,
  Text,
  Truncate,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";
import { magnitudeOf, type Quantityish } from "../shared/magnitude";

const topics = defineTopicManifest({
  channels: ["isru.drills", "isru.converters"],
  optionalChannels: ["vessel.identity", "system.bodies"],
});

/**
 * In-situ resource operations: every drill and every chemical converter on the
 * active vessel, at live rates.
 *
 * Renders one shape whichever ISRU backend the mod elected, and never reads a
 * provider's extension bag: that detail belongs to an augment in the provider's
 * own package. Filters are contributed search terms matched against `searchText`
 * baked from the shared fields alone, so the widget holds no taxonomy.
 *
 * Both channels are active-vessel scoped, so an empty list means this vessel has
 * no drills or converters. The header's location comes from `vessel.identity`
 * and `system.bodies` because the entries carry no vessel or body field.
 *
 * The hardware on a card is a fact and survives a stale channel; what it is
 * doing (run state, rates, abundance) is withheld, with the header naming which
 * channel went.
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

/** Shared so a confirmed-none does not hand a fresh identity to `useMemo` every frame. */
const EMPTY_LIST: never[] = [];

/** Resource | rate | flow-direction, shared by every process card's table. */
const RESOURCE_TABLE_COLS = "minmax(0, 1fr) auto auto";
const RIGHT_ALIGN = { textAlign: "right" } as const;
/** `Value` typography for `Truncate`, which a long resource name needs to ellipsize inside a grid cell. */
const RESOURCE_NAME_STYLE = {
  fontSize: "var(--font-size-value)",
  color: "var(--color-text-primary)",
} as const;

/**
 * Enough decimal places to show a rate as nonzero: `base` for an ordinary
 * magnitude, widened to two significant digits below it, since life-support
 * rates sit around 0.0002 units/s and "0.000" reads as a dead process.
 */
function rateDecimals(rate: Quantityish, base: number): number {
  const magnitude = magnitudeOf(rate);
  if (magnitude === null || magnitude === 0) return base;
  const twoSignificant = 1 - Math.floor(Math.log10(Math.abs(magnitude)));
  return Math.min(6, Math.max(base, twoSignificant));
}

/**
 * Net ElectricCharge draw across every RUNNING converter (inputs minus
 * outputs), the one cheap power aggregate the shared shape supports: drills
 * carry no EC field of their own. A positive number draws power; negative
 * means the fleet is a net generator (e.g. a running fuel cell).
 *
 * `moves` is a property of the recipes; `net` is `null` the moment one
 * contributing rate cannot be read, because a partial sum understates the draw.
 */
function netElectricChargeDraw(converters: readonly IsruConverterEntry[]): {
  moves: boolean;
  net: number | null;
} {
  let moves = false;
  let net: number | null = 0;
  for (const converter of converters) {
    for (const flow of converter.inputs) {
      if (flow.resource !== "ElectricCharge") continue;
      moves = true;
      if (converter.running !== true) continue;
      const rate = magnitudeOf(flow.rate);
      net = rate === null || net === null ? null : net + rate;
    }
    for (const flow of converter.outputs) {
      if (flow.resource !== "ElectricCharge") continue;
      moves = true;
      if (converter.running !== true) continue;
      const rate = magnitudeOf(flow.rate);
      net = rate === null || net === null ? null : net - rate;
    }
  }
  return { moves, net };
}

/**
 * One row of a process's resource table: resource name, rate, and direction.
 * Returns three flat cells, not a row wrapper, so the enclosing `Grid` aligns
 * columns across every row in the card.
 */
function ResourceCells({
  flow,
  direction,
  ratesNotCurrent,
}: Readonly<{
  flow: IsruResourceFlow;
  direction: "in" | "out" | "extract";
  /** Stale rather than never arrived: the cell reads as held back, not "unknown". */
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

/**
 * The run-state chip for a rig whose channel is current. An unread flag is not
 * "stopped": the operator reads "stopped" as a rig they can start.
 */
function RunStateBadge({ running }: Readonly<{ running?: boolean | null }>) {
  if (running === null || running === undefined) {
    return <Badge severity="warning">run state unread</Badge>;
  }
  return (
    <Badge severity={running ? "nominal" : "info"}>
      {running ? "running" : "stopped"}
    </Badge>
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
      tone={!drillNotCurrent && drill.running ? "go" : "default"}
      identityColor={drill.resource ? resourceColor(drill.resource) : undefined}
      title={drill.partTitle ?? drill.partId ?? "Drill"}
      titleRight={
        <Inline wrap>
          {/* Absent on a harvester with no deploy animation, which is not "retracted". */}
          {drill.deployed !== null && drill.deployed !== undefined && (
            <Badge severity={drill.deployed ? "nominal" : "info"}>
              {drill.deployed ? "deployed" : "retracted"}
            </Badge>
          )}
          {/* A harvester stops itself when its tank fills or the ore runs out, so run state is never held over. */}
          {drillNotCurrent ? (
            <Badge severity="info">run state held</Badge>
          ) : (
            <RunStateBadge running={drill.running} />
          )}
        </Inline>
      }
    >
      <Stack>
        <Grid cols={RESOURCE_TABLE_COLS} rowGap="readout-row" align="baseline">
          <ResourceCells
            flow={{ resource: drill.resource, rate: drill.rate }}
            direction="extract"
            ratesNotCurrent={drillNotCurrent}
          />
        </Grid>
        <Inline>
          <ReadoutCaption>abundance</ReadoutCaption>
          {/* Abundance belongs to where the drill stands, and it can be driven elsewhere while the link is down. */}
          {drillNotCurrent ? (
            <Text tone="muted">{NULL_DISPLAY}</Text>
          ) : drill.abundance !== null && drill.abundance !== undefined ? (
            <Unit value={drill.abundance} decimals={2} />
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
  /** The recipe still holds; the rates, run state and starved diagnostic do not. */
  notCurrent: boolean;
}>) {
  /*
   * A running converter whose every output arrived as zero is starved. A process
   * with no outputs (a scrubber) is exempt, and an absent rate is an unread one,
   * not a stall.
   */
  const starved =
    !converterNotCurrent &&
    converter.running === true &&
    converter.outputs.length > 0 &&
    converter.outputs.every((flow) => flow.rate?.isZero() === true);

  // Identity colour, never status: what it makes if it makes anything, else what it consumes.
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
      identityColor={
        primaryResource ? resourceColor(primaryResource) : undefined
      }
      title={converter.partTitle ?? converter.partId ?? "Converter"}
      titleRight={
        <Inline wrap>
          {converterNotCurrent ? (
            <Badge severity="info">run state held</Badge>
          ) : (
            <RunStateBadge running={converter.running} />
          )}
          {starved && <Badge severity="warning">no output</Badge>}
        </Inline>
      }
    >
      <Stack>
        {/* Either recipe side can be genuinely empty, and reads as a "none" row. */}
        <Grid cols={RESOURCE_TABLE_COLS} rowGap="readout-row" align="baseline">
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

/** Whole-widget summary: process count, active count, net EC draw, and location. */
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
  netEc: { moves: boolean; net: number | null };
  /** Whether `netEc.net` is a held figure rather than the vessel's current draw. */
  netEcNotCurrent: boolean;
  location: string | undefined;
  /** Which channels stopped being current, named for the operator. */
  staleChannels: readonly string[];
}>) {
  return (
    <Cluster
      justify="start"
      wrap
      role="group"
      aria-label="Resource ops summary"
      // Each stat pairs at the related gap inside, so stats separate at the section gap.
      style={{ gap: "var(--gap-section)" }}
    >
      <Inline>
        <Text size="sm" tone="default" weight="semibold">
          {total}
        </Text>
        <ReadoutCaption>{total === 1 ? "process" : "processes"}</ReadoutCaption>
      </Inline>
      <Inline>
        <Text size="sm" tone="default" weight="semibold">
          {activeCount ?? NULL_DISPLAY}
        </Text>
        <ReadoutCaption>active</ReadoutCaption>
      </Inline>
      {/* Stays mounted while the figure is withheld: whether the vessel moves ElectricCharge is a recipe fact. */}
      {netEc.moves && (
        <Inline>
          <ReadoutCaption>net EC</ReadoutCaption>
          {netEcNotCurrent || netEc.net === null ? (
            <Text tone="muted">{NULL_DISPLAY}</Text>
          ) : (
            <Unit
              value={value("units/s", netEc.net)}
              decimals={rateDecimals(netEc.net, 2)}
            />
          )}
        </Inline>
      )}
      {location && (
        <Inline>
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
  // Each channel carries its own currency: a stale drill channel says nothing about the converters.
  const drillsReading = topics.useTelemetry("isru.drills");
  const convertersReading = topics.useTelemetry("isru.converters");
  const drillsNotCurrent = drillsReading.state === "stale";
  const convertersNotCurrent = convertersReading.state === "stale";

  const allDrills = useMemo(
    () => stillTrue(drillsReading, EMPTY_LIST) ?? EMPTY_LIST,
    [drillsReading],
  );
  const allConverters = useMemo(
    () => stillTrue(convertersReading, EMPTY_LIST) ?? EMPTY_LIST,
    [convertersReading],
  );
  const anything = allDrills.length + allConverters.length > 0;
  // "None on this vessel" is a claim about the craft, so it waits for both channels to have said so.
  const bothAnswered =
    hasAnswered(drillsReading) && hasAnswered(convertersReading);
  const staleChannels = [
    ...(drillsNotCurrent ? ["drills"] : []),
    ...(convertersNotCurrent ? ["converters"] : []),
  ];

  // One "next" walks drills then converters, indexing the full order rather than the filtered subset.
  const total = allDrills.length + allConverters.length;
  const [highlighted, setHighlighted] = useState(0);
  const current = total > 0 ? highlighted % total : 0;

  useActionInput<ResourceOpsActions>({
    next: (payload) => {
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

  // Withheld the moment either side of the sum stops being current.
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

  // A vessel's name and parent body change only on an event, so the last answer still holds.
  const identity = stillTrue(topics.useTelemetry("vessel.identity"), undefined);
  const systemBodies = stillTrue(
    topics.useTelemetry("system.bodies"),
    undefined,
  );
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

  // `searchText` comes from the shared fields only, which contributed filter terms match against.
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
      <Panel
        panelTitle="RESOURCE OPS"
        compactTitle={["RES OPS", "RES"]}
        sections={
          <Section full>
            <EmptyState layout="fill">
              {bothAnswered
                ? "No drills or converters on this vessel"
                : "No ISRU data"}
            </EmptyState>
          </Section>
        }
      />
    );
  }

  return (
    <Panel
      panelTitle="RESOURCE OPS"
      compactTitle={["RES OPS", "RES"]}
      sections={[
        <Section key="summary" full>
          <ResourceOpsStats
            total={total}
            activeCount={activeCount}
            netEc={netEc}
            netEcNotCurrent={convertersNotCurrent}
            location={location}
            staleChannels={staleChannels}
          />
        </Section>,
        /* No `ScrollArea` here: Panel's body is already the scroller. */
        <Section key="processes" full>
          <FilterList
            rows={rows}
            emptyLabel="Nothing on this vessel matches the filter"
          />
        </Section>,
      ]}
    />
  );
}

registerComponent<ResourceOpsConfig>({
  id: "resource-ops",
  name: "Resource Ops",
  description:
    "Every drill and chemical converter on the active vessel, grouped into cards: resource, live abundance and extraction rate, deploy and run state, and each converter's recipe as an aligned input/output table. A summary header shows process count, active count, and net EC draw. Renders identically whichever ISRU backend the mod elected.",
  tags: ["telemetry", "resources"],
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 3, h: 4 },
  component: ResourceOpsComponent,
  channels: topics.channels,
  optionalChannels: topics.optionalChannels,
  defaultConfig: {},
  actions: resourceOpsActions,
  pushable: true,
});

export { ResourceOpsComponent };
