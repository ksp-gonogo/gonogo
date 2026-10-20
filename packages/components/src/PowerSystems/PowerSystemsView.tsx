import type { ComponentProps } from "@ksp-gonogo/core";
import { useTelemetry } from "@ksp-gonogo/core";
import { useDataSeries } from "@ksp-gonogo/data";
import { readingOf } from "@ksp-gonogo/sitrep-client";
import { VisuallyHidden } from "@ksp-gonogo/ui";
import {
  getWidgetShape,
  NULL_DISPLAY,
  Panel,
  Section,
  Select,
  Text,
  Unit,
  WidgetScopeProvider,
} from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import { heldGrade } from "../shared/heldGrade";
import { magnitudeOf } from "../shared/magnitude";
import { ContributionSection } from "./ContributionSection";
import { netRate } from "./chargeRate";
import type { PowerSystemsConfig } from "./config";
import { type NetTone, netToneWithUnrated, splitCamel } from "./flow";
import { OtherDrawRow } from "./OtherDrawRow";
import { PowerTotals } from "./PowerTotals";
import { ResourceTrend } from "./ResourceTrend";
import type { PowerSystemsScope } from "./slots";
import {
  COMPACT_BODY,
  COMPACT_NET,
  COMPACT_RESOURCE,
  CONTRIB_LIST,
  HINT,
  RESOURCE_SELECT,
  SECTION_EMPTY,
  SectionsScroll,
} from "./styles";
import {
  useCycleResourceAction,
  useLiveParts,
  useMeasuredCharge,
  useResourceBreakdown,
  useResourcePick,
} from "./usePowerFlow";

/** Sparkline window in seconds, long enough to show a sun-to-shadow EC drain. */
const SPARKLINE_WINDOW_SEC = 120;

const COMPACT_NET_TONE = {
  go: "go",
  warn: "warn",
  neutral: "neutral",
} as const;

const NET_ANNOUNCEMENT: Record<NetTone, string> = {
  go: "Power surplus",
  warn: "Power deficit",
  neutral: "Power balanced",
};

export function PowerSystemsComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<PowerSystemsConfig>>) {
  const { topology, liveByFlightId, resourcesWithFlow, resourcesPresent } =
    useLiveParts();

  /**
   * `parts.power.totalProductionEc` never feeds PROD/NET, which always sum the itemised rows; it is shown apart, as measured, only when it disagrees.
   *
   * A held figure is withheld, since it would manufacture a disagreement out of two readings taken at different times.
   */
  const powerReading = useTelemetry("parts.power");
  const streamPower =
    powerReading.state === "observed" ? powerReading.value : undefined;
  /**
   * Every figure drawn comes off the one `vessel.parts` read, so its currency is marked once on the totals row, in the body because the header aside holds the resource picker.
   *
   * Held rates and levels are kept: a blank cell would read as a vessel with no load.
   */
  const partsReading = useTelemetry("vessel.parts");
  const partsHeld = heldGrade(partsReading);

  const { resource, pickerResources, pick } = useResourcePick(
    config?.defaultResource ?? "ElectricCharge",
    resourcesWithFlow,
    resourcesPresent,
  );

  useCycleResourceAction(resourcesWithFlow, resource, pick);

  const scope = useMemo<PowerSystemsScope>(() => ({ resource }), [resource]);

  const {
    contributions,
    producers,
    consumers,
    idle,
    totalProduced,
    totalConsumed,
    net,
    flowMeasured,
    unratedCount,
    storage,
  } = useResourceBreakdown(topology, liveByFlightId, resource);

  const measuredTotalProduced =
    resource === "ElectricCharge"
      ? (magnitudeOf(streamPower?.totalProductionEc) ?? undefined)
      : undefined;
  const measuredDisagrees =
    measuredTotalProduced !== undefined &&
    Math.abs(measuredTotalProduced - totalProduced) > 0.01;

  const isCharge = resource === "ElectricCharge";
  const {
    unknown: drawUnknown,
    net: measuredNet,
    consumption: measuredConsumption,
    other: measuredOther,
  } = useMeasuredCharge(resource);
  // The stored charge counts every draw and source, so it replaces the itemised sum whenever it is known.
  const shownNet = measuredNet ?? net;
  const shownConsumed =
    measuredConsumption === undefined ? totalConsumed : -measuredConsumption;

  const seriesKey = `vessel.resources.resources.${resource}.current`;
  const series = useDataSeries(seriesKey, SPARKLINE_WINDOW_SEC);
  const sparkValues = useMemo(
    () =>
      series.v.filter(
        (v): v is number => typeof v === "number" && Number.isFinite(v),
      ),
    [series.v],
  );
  // Anchored to capacity so a half-full battery reads as half-full.
  const sparkDomain = useMemo<[number, number] | undefined>(
    () =>
      storage && storage.maxAmount > 0 ? [0, storage.maxAmount] : undefined,
    [storage],
  );

  const cols = w ?? 8;
  const rows = h ?? 10;
  // A landscape box is too short for the height gate, so it lays the sections side by side instead of going compact.
  const { shape } = getWidgetShape(w, h);
  const isLandscape = shape === "landscape";
  const showFullList = cols >= 6 && (rows >= 8 || isLandscape);
  const showHeader = rows >= 4;

  if (!topology) {
    return (
      <Panel
        panelTitle="POWER SYSTEMS"
        compactTitle={["POWER"]}
        sections={
          <Section full>
            <div style={HINT}>Waiting for vessel topology...</div>
          </Section>
        }
      />
    );
  }

  if (resourcesWithFlow.length === 0) {
    return (
      <Panel
        panelTitle="POWER SYSTEMS"
        compactTitle={["POWER"]}
        sections={
          <Section full>
            {showHeader && (
              <div style={SECTION_EMPTY} role="status">
                No active flow on any resource
              </div>
            )}
            <div style={HINT}>
              Deploy a solar panel, run a generator, or fire an engine to see
              flow contributions here.
            </div>
          </Section>
        }
      />
    );
  }

  const netTone = drawUnknown
    ? "neutral"
    : netToneWithUnrated(
        shownNet,
        measuredNet === undefined ? unratedCount : 0,
      );

  if (!showFullList) {
    return (
      <Panel
        panelTitle="POWER"
        fitToSize
        sections={
          <Section gap="related-dense" style={COMPACT_BODY}>
            <div style={COMPACT_RESOURCE}>{splitCamel(resource)}</div>
            <Text tone={COMPACT_NET_TONE[netTone]} style={COMPACT_NET}>
              {flowMeasured && !drawUnknown ? (
                <>
                  {shownNet >= 0 ? "+" : ""}
                  <Unit
                    value={readingOf(partsReading, () =>
                      netRate(resource, shownNet),
                    )}
                    decimals={2}
                  />
                </>
              ) : (
                NULL_DISPLAY
              )}
            </Text>
          </Section>
        }
      />
    );
  }

  return (
    <WidgetScopeProvider widget="power-systems" scope={scope}>
      <Panel
        panelTitle="POWER SYSTEMS"
        compactTitle={["POWER"]}
        panelBadges={
          partsHeld === undefined
            ? undefined
            : [{ id: "read", label: "Reading", held: partsHeld }]
        }
        panelAside={
          <Select
            style={RESOURCE_SELECT}
            value={resource}
            onChange={(e) => pick(e.target.value)}
            aria-label="Resource"
          >
            {pickerResources.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        }
        sections={[
          <Section key="summary" full>
            {/* Announces the state word only, so the ticking NET value does not flood a screen reader. */}
            <VisuallyHidden role="status" aria-live="polite">
              {NET_ANNOUNCEMENT[netTone]}
            </VisuallyHidden>

            {contributions.length === 0 && (
              <div style={SECTION_EMPTY} role="status">
                No active {splitCamel(resource)} flow right now.
              </div>
            )}

            <PowerTotals
              netFigure={
                flowMeasured && !drawUnknown
                  ? readingOf(partsReading, () => netRate(resource, shownNet))
                  : null
              }
              drawUnknown={drawUnknown}
              flowMeasured={flowMeasured}
              net={shownNet}
              netTone={netTone}
              unratedCount={measuredNet === undefined ? unratedCount : 0}
              totalProduced={totalProduced}
              totalConsumed={shownConsumed}
              measuredTotalProduced={measuredTotalProduced}
              measuredDisagrees={measuredDisagrees}
              storage={storage}
            />

            {storage && storage.maxAmount > 0 && sparkValues.length >= 2 && (
              <ResourceTrend
                resource={resource}
                windowSec={SPARKLINE_WINDOW_SEC}
                values={sparkValues}
                domain={sparkDomain}
                netTone={netTone}
              />
            )}
          </Section>,
          <Section key="breakdown" fill>
            <SectionsScroll $landscape={isLandscape}>
              <ContributionSection
                title="Producers"
                rows={producers}
                emptyText="Nothing producing"
                listStyle={CONTRIB_LIST}
                landscape={isLandscape}
                currency={partsReading}
              />
              <ContributionSection
                title="Consumers"
                rows={consumers}
                emptyText="Nothing consuming"
                trailing={
                  isCharge && flowMeasured ? (
                    <OtherDrawRow draw={measuredOther ?? null} />
                  ) : undefined
                }
                listStyle={CONTRIB_LIST}
                landscape={isLandscape}
                currency={partsReading}
              />
              <ContributionSection
                title="Idle"
                rows={idle}
                listStyle={CONTRIB_LIST}
                landscape={isLandscape}
                currency={partsReading}
              />
            </SectionsScroll>
          </Section>,
        ]}
      />
    </WidgetScopeProvider>
  );
}
