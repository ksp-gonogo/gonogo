import type {
  ActionDefinition,
  ComponentProps,
  ConfigComponentProps,
} from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  registerComponent,
  useActionInput,
} from "@ksp-gonogo/core";
import { useCommand, withoutReckoning } from "@ksp-gonogo/sitrep-client";
import {
  stillTrue,
  TargetKind,
  type TargetListEntry,
  VesselType,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Button,
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  NULL_DISPLAY,
  Panel,
  Row,
  ScrollArea,
  Section,
  Spinner,
  Unit,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import {
  bare,
  closingRateReading,
  radialSpeed,
  rangeReading,
  targetKindLabel,
  vecMagnitude,
} from "../shared/dockAngles";
import { magnitudeOf } from "../shared/magnitude";
import { OrbitalEventChips } from "../shared/OrbitalEventChips";

const topics = defineTopicManifest({
  channels: ["target.available", "vessel.target"],
});

// Config is empty: everything comes off the one `target.available` list.
type TargetPickerConfig = Record<string, never>;

// `target-picker.sections`: a body slot for a fleet-management Uplink's filter or grouping view.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "target-picker.sections": Record<string, never>;
  }
}

/**
 * `Sitrep.Contract.VesselType`'s C# declared order: ordinal to display label
 * for a `target.available` entry's `vesselType`. Alignment with the SDK enum is
 * locked by `enumLabelDrift.test.ts`.
 */
const VESSEL_TYPE_LABELS: readonly string[] = [
  "Ship",
  "Station",
  "Lander",
  "Probe",
  "Rover",
  "Base",
  "Relay",
  "EVA",
  "Flag",
  "Debris",
  "SpaceObject",
  "DeployedScienceController",
  "DeployedSciencePart",
  "DroppedPart",
  "Unknown",
];

/** Derived from the generated SDK enum, so it tracks the C# declaration order. */
export const SPACE_OBJECT_VESSEL_TYPE = VesselType.SpaceObject;

/** `Sitrep.Contract.Situation`'s C# declared order: ordinal to label, locked by `enumLabelDrift.test.ts`. */
const SITUATION_LABELS: readonly string[] = [
  "Landed",
  "Splashed",
  "Pre-Launch",
  "Orbiting",
  "Escaping",
  "Flying",
  "Sub-Orbital",
  "Docked",
  "Unknown",
];

const targetPickerActions = [
  {
    id: "clear-target",
    label: "Clear target",
    accepts: ["button"],
    description: "Clears the current KSP target.",
  },
] as const satisfies readonly ActionDefinition[];
type TargetPickerActions = typeof targetPickerActions;

/** Stable per-entry id, the pending-spinner key and React key, baked from the id `vessel.target.set` takes. */
function entryId(entry: TargetListEntry): string {
  switch (entry.kind) {
    case TargetKind.Body:
      return `body:${entry.bodyIndex}`;
    case TargetKind.Vessel:
      return `vessel:${entry.vesselId}`;
    case TargetKind.Part:
      return `part:${entry.vesselId}:${entry.partId}`;
    default:
      return `other:${entry.name}`;
  }
}

/** Type and situation subtitle for a Vessel/Part row; `null` for a Body or when neither resolves. */
function entrySubtitle(entry: TargetListEntry): string | null {
  if (entry.kind !== TargetKind.Vessel && entry.kind !== TargetKind.Part) {
    return null;
  }
  // `!= null`: an unclassified entry arrives as an explicit null.
  const type =
    entry.vesselType != null ? VESSEL_TYPE_LABELS[entry.vesselType] : undefined;
  const situation =
    entry.situation != null ? SITUATION_LABELS[entry.situation] : undefined;
  const parts = [type, situation].filter((v): v is string => Boolean(v));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Ascending by `distance`, undefined last. */
function sortByDistance(list: readonly TargetListEntry[]): TargetListEntry[] {
  return [...list].sort((a, b) => {
    const da = magnitudeOf(a.distance) ?? Number.POSITIVE_INFINITY;
    const db = magnitudeOf(b.distance) ?? Number.POSITIVE_INFINITY;
    return da - db;
  });
}

/** What a confirmed-no-targets tombstone means: a roster, and it is empty. */
const EMPTY_ROSTER = { entries: [] as TargetListEntry[] };

function TargetPickerComponent({
  w,
  h,
}: Readonly<ComponentProps<TargetPickerConfig>>) {
  /**
   * The roster and the current target are facts, so both take `stillTrue`: a
   * held target is what we last told the craft and what it last confirmed.
   */
  const availableReading = topics.useTelemetry("target.available");
  // A confirmed empty sky IS an empty roster; only `pending` renders the wait.
  const available = stillTrue(availableReading, EMPTY_ROSTER);
  // The model is dropped: a picker offering a modelled range beside a name is the confident-wrong picture.
  const targetReading = topics.useTelemetry("vessel.target");
  const target = stillTrue(withoutReckoning(targetReading), undefined);
  const tarName = target?.name;
  const tarType = targetKindLabel(target?.kind);
  const tarRelPos = target?.relativePosition && bare(target.relativePosition);
  const tarRelVelVec =
    target?.relativeVelocity && bare(target.relativeVelocity);
  const tarDistance = tarRelPos ? vecMagnitude(tarRelPos) : undefined;
  const tarRelVel =
    tarRelPos && tarRelVelVec
      ? radialSpeed(tarRelPos, tarRelVelVec)
      : undefined;
  // The plain numbers decide whether a row EXISTS; these are what it draws, so a held range is marked.
  const rangeR = rangeReading(targetReading.relativePosition);
  const closingRateR = closingRateReading(
    targetReading.relativePosition,
    targetReading.relativeVelocity,
  );
  /** Setting or clearing the target is subject to signal delay; every kind sets through `vessel.target.set`, keyed by `entry.kind`. */
  const setTargetCmd = useCommand("vessel.target.set");
  const clearTargetCmd = useCommand("vessel.target.clear");
  usePanelDelay(setTargetCmd);
  usePanelDelay(clearTargetCmd);

  const [filter, setFilter] = useState("");
  const [showSpaceObjects, setShowSpaceObjects] = useState(false);
  const [bodiesExpanded, setBodiesExpanded] = useState(true);
  const [vesselsExpanded, setVesselsExpanded] = useState(true);
  const [partsExpanded, setPartsExpanded] = useState(true);
  const [otherExpanded, setOtherExpanded] = useState(true);

  useActionInput<TargetPickerActions>({
    "clear-target": (payload) => {
      if (payload.kind !== "button" || payload.value !== true) return;
      void clearTargetCmd.send(undefined, { label: "Clear target" });
    },
  });

  // The row awaiting the `vessel.target` readback, spinning until it confirms or a 5 s safety net clears it; a Suggested row and its category twin light up together.
  const [pendingTarget, setPendingTarget] = useState<{
    id: string;
    expectedName: string;
    since: number;
  } | null>(null);
  useEffect(() => {
    if (pendingTarget === null) return;
    if (tarName === pendingTarget.expectedName) {
      setPendingTarget(null);
      return;
    }
    const id = setTimeout(() => setPendingTarget(null), 5000);
    return () => clearTimeout(id);
  }, [pendingTarget, tarName]);

  const dispatchTarget = (entry: TargetListEntry) => {
    const id = entryId(entry);
    const label = `Target ${entry.name}`;
    if (entry.kind === TargetKind.Body) {
      // A null index is a refusal: never command the craft on a guess.
      if (typeof entry.bodyIndex !== "number") return;
      setPendingTarget({ id, expectedName: entry.name, since: Date.now() });
      void setTargetCmd.send(
        { kind: TargetKind.Body, bodyIndex: entry.bodyIndex },
        { label },
      );
    } else if (entry.kind === TargetKind.Vessel) {
      if (!entry.vesselId) return;
      setPendingTarget({ id, expectedName: entry.name, since: Date.now() });
      void setTargetCmd.send(
        { kind: TargetKind.Vessel, vesselId: entry.vesselId },
        { label },
      );
    } else if (entry.kind === TargetKind.Part) {
      // `== null`: an unidentified part arrives as an explicit null.
      if (!entry.vesselId || entry.partId == null) return;
      setPendingTarget({ id, expectedName: entry.name, since: Date.now() });
      void setTargetCmd.send(
        {
          kind: TargetKind.Part,
          vesselId: entry.vesselId,
          partId: entry.partId,
        },
        { label },
      );
    }
    // An `Other`-kind entry has no id-based set command, so a click is intentionally a no-op.
  };
  const clearTarget = () => {
    setPendingTarget(null);
    void clearTargetCmd.send(undefined, { label: "Clear target" });
  };

  const entries = available?.entries ?? [];
  const filterText = filter.trim().toLowerCase();
  const isFiltering = filterText.length > 0;

  const nameFiltered = useMemo(() => {
    if (!isFiltering) return entries;
    return entries.filter((e) => e.name.toLowerCase().includes(filterText));
  }, [entries, filterText, isFiltering]);

  const spaceObjectCount = useMemo(
    () =>
      nameFiltered.filter(
        (e) =>
          e.kind === TargetKind.Vessel &&
          e.vesselType === SPACE_OBJECT_VESSEL_TYPE,
      ).length,
    [nameFiltered],
  );

  // The asteroid/comet toggle applies to Vessel-kind entries only.
  const visible = useMemo(
    () =>
      nameFiltered.filter(
        (e) =>
          !(
            e.kind === TargetKind.Vessel &&
            e.vesselType === SPACE_OBJECT_VESSEL_TYPE &&
            !showSpaceObjects
          ),
      ),
    [nameFiltered, showSpaceObjects],
  );

  const bodiesList = useMemo(
    () => sortByDistance(visible.filter((e) => e.kind === TargetKind.Body)),
    [visible],
  );
  const vesselsList = useMemo(
    () => sortByDistance(visible.filter((e) => e.kind === TargetKind.Vessel)),
    [visible],
  );
  const partsList = useMemo(
    () => sortByDistance(visible.filter((e) => e.kind === TargetKind.Part)),
    [visible],
  );
  // Anything not a Body/Vessel/Part buckets here rather than rendering invisibly.
  const otherList = useMemo(
    () =>
      sortByDistance(
        visible.filter(
          (e) =>
            e.kind !== TargetKind.Body &&
            e.kind !== TargetKind.Vessel &&
            e.kind !== TargetKind.Part,
        ),
      ),
    [visible],
  );

  // Suggested: 2 closest Bodies, 2 closest Vessels and all Parts.
  const suggested = useMemo(
    () => [...bodiesList.slice(0, 2), ...vesselsList.slice(0, 2), ...partsList],
    [bodiesList, vesselsList, partsList],
  );

  const noCategoriesHaveEntries =
    bodiesList.length === 0 &&
    vesselsList.length === 0 &&
    partsList.length === 0 &&
    otherList.length === 0;

  // At very small sizes, collapse to a current-target readout.
  const cols = w ?? 6;
  const rows = h ?? 11;
  const showFull = rows >= 6 && cols >= 4;

  if (!showFull) {
    return (
      <Panel
        panelTitle="TARGET"
        sections={
          <Section fill>
            <CompactCurrent>
              {tarName ? (
                <>
                  <CompactName>{tarName}</CompactName>
                  {typeof tarDistance === "number" &&
                    Number.isFinite(tarDistance) && (
                      <CompactDistance>
                        <Unit value={rangeR} />
                      </CompactDistance>
                    )}
                </>
              ) : (
                <Hint>No target set</Hint>
              )}
            </CompactCurrent>
          </Section>
        }
      />
    );
  }

  const renderRow = (entry: TargetListEntry, keyPrefix: string) => {
    const subtitle = entrySubtitle(entry);
    const isPending = pendingTarget?.id === entryId(entry);
    return (
      <Row
        as="button"
        interactive
        key={`${keyPrefix}:${entryId(entry)}`}
        type="button"
        selected={entry.isCurrent}
        onClick={() => dispatchTarget(entry)}
      >
        <RowMain>
          <EntryName>{entry.name}</EntryName>
          {subtitle && <RowSubtitle>{subtitle}</RowSubtitle>}
        </RowMain>
        <RowDistance>
          {entry.distance === undefined ? (
            NULL_DISPLAY
          ) : (
            <Unit value={entry.distance} />
          )}
        </RowDistance>
        {isPending && <Spinner ariaLabel="Setting target" />}
        {!isPending && entry.isCurrent && <RowTag>TARGET</RowTag>}
      </Row>
    );
  };

  return (
    <Panel
      panelTitle="TARGET PICKER"
      sections={[
        <Section key="summary" full>
          <OrbitalEventChipsRow>
            <OrbitalEventChips />
          </OrbitalEventChipsRow>
          <CurrentSummary>
            {tarName === undefined ? (
              <Hint>No target set in KSP.</Hint>
            ) : (
              <>
                <CurrentSummaryTop>
                  <CurrentSummaryName title={tarName}>
                    {tarName}
                  </CurrentSummaryName>
                  {typeof tarDistance === "number" &&
                    Number.isFinite(tarDistance) && (
                      <CurrentSummaryDistance>
                        <Unit value={rangeR} />
                      </CurrentSummaryDistance>
                    )}
                </CurrentSummaryTop>
                <CurrentSummaryMeta>
                  {tarType && <span>{tarType}</span>}
                  {typeof tarRelVel === "number" &&
                    Number.isFinite(tarRelVel) && (
                      <span>
                        Δv <Unit value={closingRateR} decimals={2} />
                      </span>
                    )}
                  <Button onClick={clearTarget} type="button">
                    Clear target
                  </Button>
                </CurrentSummaryMeta>
              </>
            )}
          </CurrentSummary>
          <FilterInput
            type="search"
            placeholder="Filter targets"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter targets"
          />
        </Section>,
        /* The list takes the height the chips, the current target and the filter leave. */
        <Section key="list" fill>
          {available === undefined ? (
            <Hint>Waiting for target list...</Hint>
          ) : (
            <ListScroll>
              {suggested.length > 0 && (
                <Section>
                  <SuggestedHeading>Suggested</SuggestedHeading>
                  <SectionBody>
                    {suggested.map((entry) => renderRow(entry, "suggested"))}
                  </SectionBody>
                </Section>
              )}
              {bodiesList.length > 0 && (
                <CategorySection
                  id="bodies"
                  label="Bodies"
                  count={bodiesList.length}
                  expanded={bodiesExpanded}
                  onToggle={() => setBodiesExpanded((v) => !v)}
                >
                  {bodiesList.map((entry) => renderRow(entry, "body"))}
                </CategorySection>
              )}
              {vesselsList.length > 0 && (
                <CategorySection
                  id="vessels"
                  label="Vessels"
                  count={vesselsList.length}
                  expanded={vesselsExpanded}
                  onToggle={() => setVesselsExpanded((v) => !v)}
                  extra={
                    spaceObjectCount > 0 && (
                      <SpaceObjectToggle
                        type="button"
                        aria-pressed={showSpaceObjects}
                        onClick={() => setShowSpaceObjects((v) => !v)}
                        title={
                          showSpaceObjects
                            ? "Hide asteroids / comets from the list"
                            : "Show asteroids / comets in the list"
                        }
                      >
                        {showSpaceObjects
                          ? `Asteroids: shown (${spaceObjectCount})`
                          : `Asteroids: hidden (${spaceObjectCount})`}
                      </SpaceObjectToggle>
                    )
                  }
                >
                  {vesselsList.map((entry) => renderRow(entry, "vessel"))}
                </CategorySection>
              )}
              {partsList.length > 0 && (
                <CategorySection
                  id="parts"
                  label="Parts"
                  count={partsList.length}
                  expanded={partsExpanded}
                  onToggle={() => setPartsExpanded((v) => !v)}
                >
                  {partsList.map((entry) => renderRow(entry, "part"))}
                </CategorySection>
              )}
              {otherList.length > 0 && (
                <CategorySection
                  id="other"
                  label="Other"
                  count={otherList.length}
                  expanded={otherExpanded}
                  onToggle={() => setOtherExpanded((v) => !v)}
                >
                  {otherList.map((entry) => renderRow(entry, "other"))}
                </CategorySection>
              )}
              {noCategoriesHaveEntries && (
                <Hint>
                  {isFiltering ? "No targets match." : "No targets in range."}
                </Hint>
              )}
            </ListScroll>
          )}
        </Section>,
      ]}
    />
  );
}

interface CategorySectionProps {
  id: string;
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  extra?: ReactNode;
  children: ReactNode;
}

/** A disclosure: a `<button>` heading with `aria-expanded` and `aria-controls` on the collapsible body. */
function CategorySection({
  id,
  label,
  count,
  expanded,
  onToggle,
  extra,
  children,
}: Readonly<CategorySectionProps>) {
  const panelId = `target-picker-section-${id}`;
  return (
    <Section>
      <SectionHeaderRow>
        <SectionToggle
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <SectionChevron $expanded={expanded} aria-hidden="true">
            ▸
          </SectionChevron>
          {label} ({count})
        </SectionToggle>
        {extra}
      </SectionHeaderRow>
      {expanded && <SectionBody id={panelId}>{children}</SectionBody>}
    </Section>
  );
}

function TargetPickerConfigComponent(
  _props: Readonly<ConfigComponentProps<TargetPickerConfig>>,
) {
  return (
    <ConfigForm>
      <Field>
        <FieldLabel>Target Picker</FieldLabel>
        <FieldHint>
          No config: every target (bodies, vessels, docking ports) comes from
          the <code>target.available</code> list. Click a row to set the KSP
          target; Clear target on the current target drops it.
        </FieldHint>
      </Field>
    </ConfigForm>
  );
}

/** Collapses when there is no encounter or apsis data. */
const OrbitalEventChipsRow = styled.div`
  display: flex;
  &:empty {
    display: none;
  }
`;

const CurrentSummary = styled.div`
  margin-top: var(--gap-related-compact);
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const CurrentSummaryTop = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--gap-related);
`;

const CurrentSummaryName = styled.span`
  font-size: var(--font-size-value);
  font-weight: 600;
  color: var(--color-status-go-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
`;

const CurrentSummaryDistance = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
`;

const CurrentSummaryMeta = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-headline);
  font-size: var(--font-size-caption);
  color: var(--color-text-muted);
  letter-spacing: 0.04em;
`;

const FilterInput = styled.input`
  margin-top: var(--gap-related-compact);
  font-size: var(--font-size-value);
  padding: var(--inset-control);
  background: var(--color-surface-app);
  border: 1px solid var(--color-surface-raised);
  border-radius: var(--radius-regular);
  color: var(--color-text-primary);
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const ListScroll = styled(ScrollArea)`
  flex: 1;
  margin-top: var(--gap-related-compact);
  [data-scroll-area-inner] {
    display: flex;
    flex-direction: column;
    gap: var(--gap-related);
  }
`;

const SuggestedHeading = styled.div`
  font-size: var(--font-size-caption);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  /* Shared with SectionToggle, so the heading and the toggle start on one left edge. */
  padding: var(--inset-list-heading);
`;

const SectionHeaderRow = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
`;

const SectionToggle = styled.button`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  /* Shared with SuggestedHeading. */
  padding: var(--inset-list-heading);
  font-size: var(--font-size-compact);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  &:hover {
    color: var(--color-text-primary);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const SectionChevron = styled.span<{ $expanded: boolean }>`
  display: inline-block;
  transition: transform var(--duration-fast) var(--ease-standard);
  transform: rotate(${({ $expanded }) => ($expanded ? "90deg" : "0deg")});
  flex-shrink: 0;
`;

const SectionBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-line);
`;

const RowMain = styled.span`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
`;

const EntryName = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const RowSubtitle = styled.span`
  font-size: var(--font-size-caption);
  color: currentColor;
  opacity: 0.7;
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

const RowDistance = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  margin-right: var(--gap-trailing-mark);
  flex-shrink: 0;
`;

const RowTag = styled.span`
  font-size: var(--font-size-compact);
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--color-status-go-fg);
`;

const SpaceObjectToggle = styled.button`
  margin-left: auto;
  font-size: var(--font-size-compact);
  padding: var(--inset-control-small);
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-surface-raised);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  letter-spacing: 0.04em;
  font-family: inherit;
  &[aria-pressed="true"] {
    color: var(--color-status-info-fg);
    border-color: var(--color-status-info-fg);
  }
  &:hover {
    filter: brightness(1.15);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const Hint = styled.div`
  margin-top: var(--gap-related-compact);
  font-size: var(--font-size-compact);
  color: var(--color-text-faint);
  line-height: var(--line-height-body);
`;

const CompactCurrent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--gap-related);
  text-align: center;
`;

const CompactName = styled.div`
  font-size: var(--font-size-value);
  font-weight: 700;
  color: var(--color-text-primary);
  letter-spacing: 0.04em;
`;

const CompactDistance = styled.div`
  font-size: var(--font-size-compact);
  color: var(--color-accent-fg);
  letter-spacing: 0.04em;
`;

registerComponent<TargetPickerConfig>({
  id: "target-picker",
  name: "Target Picker",
  description:
    "Pick a target from a single Suggested + categorised list (Bodies / Vessels / Parts) driven by the `target.available` channel, or inspect the current target's name / type / distance / Δv and clear it.",
  tags: ["telemetry", "navigation"],
  defaultSize: { w: 6, h: 11 },
  minSize: { w: 3, h: 3 },
  component: TargetPickerComponent,
  configComponent: TargetPickerConfigComponent,
  augmentSlots: ["target-picker.sections"],
  channels: topics.channels,
  defaultConfig: {},
  actions: targetPickerActions,
  pushable: true,
  requires: ["flight"],
});

// Aliased for `enumLabelDrift.test.ts`, since LaunchDirector declares its own `VESSEL_TYPE_LABELS`.
export {
  SITUATION_LABELS as TARGET_PICKER_SITUATION_LABELS,
  TargetPickerComponent,
  VESSEL_TYPE_LABELS as TARGET_PICKER_VESSEL_TYPE_LABELS,
};
