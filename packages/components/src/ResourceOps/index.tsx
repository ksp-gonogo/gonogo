import type { ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  registerComponent,
  useActionInput,
} from "@ksp-gonogo/core";
import { hasAnswered, stillTrue } from "@ksp-gonogo/sitrep-sdk";
import {
  EmptyState,
  FilterList,
  type FilterRow,
  Panel,
  Section,
} from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";
import { ConverterCard } from "./ConverterCard";
import {
  type ResourceOpsActions,
  type ResourceOpsConfig,
  resourceOpsActions,
} from "./config";
import { DrillCard } from "./DrillCard";
import { ResourceOpsStats } from "./ResourceOpsStats";
import { converterResources, netElectricChargeDraw } from "./rates";

export type { ResourceOpsActions } from "./config";

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

/** Shared so a confirmed-none does not hand a fresh identity to `useMemo` every frame. */
const EMPTY_LIST: never[] = [];

function locationLabel(
  vesselName: string | null | undefined,
  bodyName: string | null | undefined,
): string | undefined {
  if (!vesselName) return undefined;
  if (!bodyName) return vesselName;
  return `${vesselName} · ${bodyName}`;
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
  const location = locationLabel(identity?.name, bodyName);

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
