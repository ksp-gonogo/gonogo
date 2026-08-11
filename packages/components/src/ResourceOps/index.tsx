import type {
  ActionDefinition,
  ComponentProps,
  FilterEntry,
} from "@ksp-gonogo/core";
import {
  registerComponent,
  useActionInput,
  useContributedFilters,
  useTelemetry,
} from "@ksp-gonogo/core";
import type {
  IsruConverterEntry,
  IsruDrillEntry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  EmptyState,
  FilterBar,
  Inline,
  Panel,
  ReadoutCaption,
  ScrollArea,
  Section,
  SectionTitle,
  Stack,
  Unit,
  Value,
} from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";
import { magnitudeOf, type Quantityish } from "../shared/magnitude";
// Side-effect import: the built-in half of the `resource-ops.filters`
// self-contribution (the by-resource axis), on the same slot an Uplink
// contributes its own axis to.
import "./resourceFilters";
import type { ResourceOpsUnit } from "./unit";

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
 * ACTIVE-VESSEL SCOPED: both channels capture off the active vessel only, the same
 * carry-gap `reliability.*` has. An empty list means this vessel has no drills or
 * converters, never that ISRU is untracked: stock genuinely models ISRU, so the
 * elected backend always has a real answer.
 */

type ResourceOpsConfig = Record<string, never>;

// This widget's filter slot (contribution-slots-spec §15), co-located with the
// widget the same way ShipMap's contribution slots are. The widget declares
// that its list is filterable and renders whatever arrives; it never learns
// what any contributed filter MEANS, which is the entire point. Mirrored for
// facade-sealed Uplinks in `mod/sitrep-sdk/src/api/contribution-slots.ts`.
declare module "@ksp-gonogo/core" {
  interface ContributionRegistry {
    "resource-ops.filters": {
      entry: FilterEntry<ResourceOpsUnit>;
      topics: "isru.drills" | "isru.converters";
    };
  }
}

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

/**
 * Enough decimal places to show a rate as nonzero: `base` for an ordinary
 * magnitude, widened to two significant digits below it. Life-support rates
 * genuinely sit at 0.0002 units/s, and a fixed precision flattens that to
 * "0.000", which reads as a dead process rather than a slow one.
 */
function rateDecimals(rate: Quantityish, base: number): number {
  const magnitude = magnitudeOf(rate);
  if (magnitude === null || magnitude === 0) return base;
  const twoSignificant = 1 - Math.floor(Math.log10(Math.abs(magnitude)));
  return Math.min(6, Math.max(base, twoSignificant));
}

/**
 * A recipe side as a run of resource+rate items. Rates are already live on the
 * wire (scaled by whatever efficiency or capacity multiplier the backend
 * applies), so this renders them as-is rather than deriving anything.
 *
 * Renders a FRAGMENT of atomic items rather than its own row: the enclosing
 * recipe row wraps, and each resource+rate pair moves to the next line whole
 * (`Inline` never shrinks), so a recipe too wide for the tile wraps instead of
 * clipping its output side.
 */
function Flows({ flows }: Readonly<{ flows: IsruConverterEntry["inputs"] }>) {
  if (flows.length === 0) return <Value tone="faint">none</Value>;

  return (
    <>
      {flows.map((flow, index) => (
        <Inline key={`${flow.resource ?? index}`} gap="xs">
          <Value size="sm" tone="default">
            {flow.resource ?? "?"}
            {flow.rate !== null && flow.rate !== undefined && (
              <>
                {" "}
                <Unit value={flow.rate} decimals={rateDecimals(flow.rate, 3)} />
              </>
            )}
          </Value>
        </Inline>
      ))}
    </>
  );
}

function DrillRow({
  drill,
  highlighted,
}: Readonly<{ drill: IsruDrillEntry; highlighted: boolean }>) {
  return (
    <Stack gap="xs" aria-current={highlighted ? "true" : undefined}>
      {/* Every row here wraps rather than clips: a no-wrap Inline cut badges
          and the rate readout off at the default tile width, and a clipped
          "0.0004" reads as a dead "0.000". */}
      <Cluster justify="start" gap="xs" wrap>
        <Value size="sm" tone="default">
          {drill.partTitle ?? drill.partId ?? "Drill"}
        </Value>
        <Badge>{drill.resource ?? "unknown"}</Badge>
        {/* Deployed is genuinely absent on a harvester with no deploy animation,
            so the chip is omitted rather than shown as a false "retracted". */}
        {drill.deployed !== null && drill.deployed !== undefined && (
          <Badge severity={drill.deployed ? "nominal" : "info"}>
            {drill.deployed ? "deployed" : "retracted"}
          </Badge>
        )}
        <Badge severity={drill.running ? "nominal" : "info"}>
          {drill.running ? "running" : "stopped"}
        </Badge>
      </Cluster>
      <Cluster justify="start" align="baseline" gap="sm" wrap>
        <Inline gap="xs">
          <ReadoutCaption>abundance</ReadoutCaption>
          {drill.abundance !== null && drill.abundance !== undefined ? (
            <Unit value={drill.abundance} as="%" decimals={2} />
          ) : (
            <Value tone="faint">unknown</Value>
          )}
        </Inline>
        <Inline gap="xs">
          <ReadoutCaption>rate</ReadoutCaption>
          {drill.rate !== null && drill.rate !== undefined ? (
            <Unit value={drill.rate} decimals={rateDecimals(drill.rate, 4)} />
          ) : (
            <Value tone="faint">unknown</Value>
          )}
        </Inline>
      </Cluster>
    </Stack>
  );
}

function ConverterRow({
  converter,
  highlighted,
}: Readonly<{ converter: IsruConverterEntry; highlighted: boolean }>) {
  // A converter that is on but moving nothing is a starved recipe. That is the
  // derived diagnostic the shared shape is meant to carry, rather than a string
  // no engine actually reports, so it is spelled out here rather than on the wire.
  // A process with NO outputs is exempt: a scrubber or waste processor consumes
  // and dumps by design, and an empty output side is its healthy state, not a
  // stall.
  const starved =
    converter.running === true &&
    converter.outputs.length > 0 &&
    converter.outputs.every((flow) => (flow.rate?.magnitude ?? 0) === 0);

  return (
    <Stack gap="xs" aria-current={highlighted ? "true" : undefined}>
      {/* Wraps for the same reason the recipe row does: at the default tile
          width a no-wrap Inline clipped the starved badge to "NO OUTPU". */}
      <Cluster justify="start" gap="xs" wrap>
        <Value size="sm" tone="default">
          {converter.partTitle ?? converter.partId ?? "Converter"}
        </Value>
        <Badge severity={converter.running ? "nominal" : "info"}>
          {converter.running ? "running" : "stopped"}
        </Badge>
        {starved && <Badge severity="warning">no output</Badge>}
      </Cluster>
      {/* The recipe is the row's core content, so it wraps rather than clips:
          a no-wrap Inline here cut the whole output side off at the default
          tile width. */}
      <Cluster justify="start" align="baseline" gap="xs" wrap>
        <Flows flows={converter.inputs} />
        <ReadoutCaption>{"→"}</ReadoutCaption>
        <Flows flows={converter.outputs} />
      </Cluster>
    </Stack>
  );
}

function ResourceOpsComponent(
  _props: Readonly<ComponentProps<ResourceOpsConfig>>,
) {
  const drills = useTelemetry("isru.drills");
  const converters = useTelemetry("isru.converters");

  const allDrills = useMemo(() => drills ?? [], [drills]);
  const allConverters = useMemo(() => converters ?? [], [converters]);
  const anything = allDrills.length + allConverters.length > 0;

  // Both lists as one tagged row set, which is what a contributed filter runs
  // against: an axis that only makes sense for converters (a mod's own process
  // identity) has to be able to say so, and one that spans both (a resource)
  // has to see both.
  const units = useMemo<ResourceOpsUnit[]>(
    () => [
      ...allDrills.map((drill) => ({ kind: "drill" as const, drill })),
      ...allConverters.map((converter) => ({
        kind: "converter" as const,
        converter,
      })),
    ],
    [allDrills, allConverters],
  );

  // Filters are CONTRIBUTED, never hardcoded here. The generic by-resource axis
  // is a built-in contribution (`./resourceFilters.ts`); a mod that knows how
  // its own converters divide up contributes that axis from its own Uplink, on
  // this same slot. So no taxonomy lives in this widget: it could not assert a
  // life-support-versus-ISRU split even if it wanted to, because it has no idea
  // which of these facets is which.
  const filters = useContributedFilters("resource-ops.filters");
  const filtered = filters.apply(units);

  const drillList = useMemo(
    () =>
      filtered.flatMap((unit) => (unit.kind === "drill" ? [unit.drill] : [])),
    [filtered],
  );
  const converterList = useMemo(
    () =>
      filtered.flatMap((unit) =>
        unit.kind === "converter" ? [unit.converter] : [],
      ),
    [filtered],
  );

  const total = drillList.length + converterList.length;

  // Index into the two lists read end to end, so one button walks the whole
  // vessel rather than needing a separate control per section.
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
        nextIndex < drillList.length
          ? drillList[nextIndex]
          : converterList[nextIndex - drillList.length];
      return { unit: entry?.partTitle ?? entry?.partId ?? "unknown" };
    },
  });

  const filter = (
    <FilterBar
      groups={filters.groups}
      onChange={filters.onChange}
      allLabel="All resources"
    />
  );

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
      <ScrollArea>
        <Stack gap="sm">
          {filter}
          {total === 0 && (
            <EmptyState>Nothing on this vessel matches the filter</EmptyState>
          )}
          {drillList.length > 0 && (
            <Section as="section" aria-label="Drills">
              <SectionTitle>Drills</SectionTitle>
              <Stack gap="xs">
                {drillList.map((drill, index) => (
                  <DrillRow
                    key={drill.partId ?? `drill-${index}`}
                    drill={drill}
                    highlighted={index === current}
                  />
                ))}
              </Stack>
            </Section>
          )}
          {converterList.length > 0 && (
            <Section as="section" aria-label="Converters">
              <SectionTitle>Converters</SectionTitle>
              <Stack gap="xs">
                {converterList.map((converter, index) => (
                  <ConverterRow
                    key={converter.partId ?? `converter-${index}`}
                    converter={converter}
                    highlighted={drillList.length + index === current}
                  />
                ))}
              </Stack>
            </Section>
          )}
        </Stack>
      </ScrollArea>
    </Panel>
  );
}

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<ResourceOpsConfig>({
  id: "resource-ops",
  name: "Resource Ops",
  description:
    "Every drill and chemical converter on the active vessel: resource, live abundance and extraction rate, deploy and run state, and each converter's recipe at live input and output rates. Renders identically whichever ISRU backend the mod elected.",
  tags: ["telemetry", "resources"],
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 3, h: 4 },
  component: ResourceOpsComponent,
  dataRequirements: ["isru.drills", "isru.converters"],
  contributionSlots: ["resource-ops.filters"],
  defaultConfig: {},
  actions: resourceOpsActions,
  pushable: true,
});

// Re-exported so the sdk mirror's drift guard
// (`contribution-slot-registry.conformance.test-d.ts`) can check this slot's
// entry type against the real one, the same way ShipMap's entry types are.
export type { ResourceOpsUnit } from "./unit";
export { ResourceOpsComponent };
