import type { ActionDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  registerComponent,
  useActionInput,
  useTelemetry,
} from "@ksp-gonogo/core";
import type {
  IsruConverterEntry,
  IsruDrillEntry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  EmptyState,
  Field,
  FieldLabel,
  Inline,
  Panel,
  ReadoutCaption,
  ScrollArea,
  Section,
  SectionTitle,
  Select,
  Stack,
  Unit,
  Value,
} from "@ksp-gonogo/ui-kit";
import { useId, useMemo, useState } from "react";

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

/** The show-everything filter selection, and the default. */
const ALL_RESOURCES = "__all__";

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
 * A recipe side as a compact resource list. Rates are already live on the wire
 * (scaled by whatever efficiency or capacity multiplier the backend applies), so
 * this renders them as-is rather than deriving anything.
 */
function Flows({ flows }: Readonly<{ flows: IsruConverterEntry["inputs"] }>) {
  if (flows.length === 0) return <Value tone="faint">none</Value>;

  return (
    <Inline gap="xs">
      {flows.map((flow, index) => (
        <Value key={`${flow.resource ?? index}`} size="sm">
          {flow.resource ?? "?"}
          {flow.rate !== null && flow.rate !== undefined && (
            <>
              {" "}
              <Unit value={flow.rate} decimals={3} />
            </>
          )}
        </Value>
      ))}
    </Inline>
  );
}

function DrillRow({
  drill,
  highlighted,
}: Readonly<{ drill: IsruDrillEntry; highlighted: boolean }>) {
  return (
    <Stack gap="xs" aria-current={highlighted ? "true" : undefined}>
      <Inline gap="xs">
        <Value size="sm">{drill.partTitle ?? drill.partId ?? "Drill"}</Value>
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
      </Inline>
      <Inline gap="sm">
        <ReadoutCaption>abundance</ReadoutCaption>
        {drill.abundance !== null && drill.abundance !== undefined ? (
          <Unit value={drill.abundance} as="%" decimals={2} />
        ) : (
          <Value tone="faint">unknown</Value>
        )}
        <ReadoutCaption>rate</ReadoutCaption>
        {drill.rate !== null && drill.rate !== undefined ? (
          <Unit value={drill.rate} decimals={4} />
        ) : (
          <Value tone="faint">unknown</Value>
        )}
      </Inline>
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
  const starved =
    converter.running === true &&
    converter.outputs.every((flow) => (flow.rate?.magnitude ?? 0) === 0);

  return (
    <Stack gap="xs" aria-current={highlighted ? "true" : undefined}>
      <Inline gap="xs">
        <Value size="sm">
          {converter.partTitle ?? converter.partId ?? "Converter"}
        </Value>
        <Badge severity={converter.running ? "nominal" : "info"}>
          {converter.running ? "running" : "stopped"}
        </Badge>
        {starved && <Badge severity="warning">no output</Badge>}
      </Inline>
      <Inline gap="xs">
        <Flows flows={converter.inputs} />
        <ReadoutCaption>{"→"}</ReadoutCaption>
        <Flows flows={converter.outputs} />
      </Inline>
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

  // Filter by RESOURCE, which is the one axis the wire genuinely has. A backend
  // that models life support with the same module a chemical plant uses reports
  // both here, deliberately, so this list can get long. The answer is to let an
  // operator pick the resource they care about rather than to hardcode a
  // life-support-vs-ISRU split: that split is not a distinction any engine draws,
  // and asserting it here would put gonogo's taxonomy on the wire's data.
  const [resource, setResource] = useState(ALL_RESOURCES);
  const filterId = useId();

  const resources = useMemo(() => {
    const names = new Set<string>();
    for (const drill of allDrills) {
      if (drill.resource) names.add(drill.resource);
    }
    for (const converter of allConverters) {
      for (const flow of [...converter.inputs, ...converter.outputs]) {
        if (flow.resource) names.add(flow.resource);
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [allDrills, allConverters]);

  // A filter naming a resource this vessel no longer has would hide everything
  // with no way back, so an unavailable selection falls back to showing all.
  const active = resources.includes(resource) ? resource : ALL_RESOURCES;

  const drillList = useMemo(
    () =>
      active === ALL_RESOURCES
        ? allDrills
        : allDrills.filter((drill) => drill.resource === active),
    [allDrills, active],
  );
  const converterList = useMemo(
    () =>
      active === ALL_RESOURCES
        ? allConverters
        : allConverters.filter((converter) =>
            [...converter.inputs, ...converter.outputs].some(
              (flow) => flow.resource === active,
            ),
          ),
    [allConverters, active],
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

  const filter = resources.length > 1 && (
    <Field>
      <FieldLabel htmlFor={filterId}>Resource</FieldLabel>
      <Select
        id={filterId}
        value={active}
        onChange={(event) => setResource(event.target.value)}
      >
        {/* Show-all is the default and the first option: nothing is hidden until
            an operator chooses to hide it. */}
        <option value={ALL_RESOURCES}>All resources</option>
        {resources.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </Select>
    </Field>
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
            <EmptyState>{`Nothing on this vessel handles ${active}`}</EmptyState>
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
  defaultConfig: {},
  actions: resourceOpsActions,
  pushable: true,
});

export { ResourceOpsComponent };
