import type {
  ActionDefinition,
  ComponentProps,
  ConfigComponentProps,
} from "@ksp-gonogo/core";
import {
  AugmentSlot,
  formatDistance,
  registerComponent,
  resolveTargetName,
  useActionInput,
  useExecuteAction,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  type StreamStatusValue,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "@ksp-gonogo/sitrep-client";
import {
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
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import styled from "styled-components";
import {
  radialSpeed,
  targetKindLabel,
  type Vec3,
  vecMagnitude,
} from "../shared/dockAngles";
import { OrbitalEventChips } from "../shared/OrbitalEventChips";

// Config is empty, bodies/vessels/parts all come off the one
// `target.available` list now, so there is nothing per-instance to save.
type TargetPickerConfig = Record<string, never>;

// ── Augment slots (Uplink architecture) ─────────────────────────────
// Two host-owned slots any Uplink may compose into. Neither carries slot props:
// they are not overlay or typed-contract slots, a bound augment
// reads its OWN Topics via hooks and fires its own actions, so both pass `{}`.
//
//  - `target-picker.sections`: a body slot for a fleet-management Uplink (mission
//    tagging / constellation grouping) to add a filter/grouping view alongside
//    the stock Suggested / Bodies / Vessels / Parts sections. No confirmed filler yet.
//  - `target-picker.badges`: the broad inline-indicator escape hatch (slot-map
//    "Feedback round 1"), sitting in the header next to the title.
//
// Typed here via co-located `SlotRegistry` declaration-merging so
// the ids type-check at the `AugmentSlot` / `registerAugment` sites rather than
// falling back to the loose `Record<string, unknown>`.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "target-picker.sections": Record<string, never>;
    "target-picker.badges": Record<string, never>;
  }
}

/** `Sitrep.Contract.VesselType`'s C# declared order (VesselEnums.cs): the
 * ordinal -> display-label bridge for a `target.available` entry's
 * `vesselType` (set for Vessel/Part-kind entries: the owning vessel's type).
 * Hand-ordered to match the generated SDK `VesselType` enum (source of
 * truth, since it's generated straight off the C# contract), index
 * alignment is locked by the drift-guard test in `enumLabelDrift.test.ts`
 * (imported there under the `TARGET_PICKER_VESSEL_TYPE_LABELS` alias at the
 * bottom of this file: LaunchDirector declares an identically-named const
 * of its own, and both can't be bare-named at the package's `export *`
 * barrel), so an inserted C# enum member fails CI here instead of silently
 * mis-labelling every row. */
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

/** Ordinal for the asteroid/comet toggle, DERIVED from the generated SDK
 * enum (not a bare literal) so it can never point at the wrong
 * `VesselType` member even if the C# declaration order changes. */
export const SPACE_OBJECT_VESSEL_TYPE = VesselType.SpaceObject;

/** `Sitrep.Contract.Situation`'s C# declared order: the ordinal -> label
 * bridge for a `target.available` entry's `situation` (set for Vessel-kind
 * entries only). Index-alignment with the generated SDK `Situation` enum is
 * locked by the drift-guard test in `enumLabelDrift.test.ts`. */
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
    description: "Clears the current KSP target via tar.clearTarget.",
  },
] as const satisfies readonly ActionDefinition[];
type TargetPickerActions = typeof targetPickerActions;

/**
 * Stable per-entry id: used both as the pending-spinner disambiguator and
 * the row's React key. Baked from the SAME stable id `tar.setTarget*` takes,
 * so it never collides across kinds.
 */
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

/** Type · situation subtitle for a Vessel/Part row. `null` for Body (bodies
 * carry neither field) or when neither resolves to a label. */
function entrySubtitle(entry: TargetListEntry): string | null {
  if (entry.kind !== TargetKind.Vessel && entry.kind !== TargetKind.Part) {
    return null;
  }
  const type =
    entry.vesselType !== undefined
      ? VESSEL_TYPE_LABELS[entry.vesselType]
      : undefined;
  const situation =
    entry.situation !== undefined
      ? SITUATION_LABELS[entry.situation]
      : undefined;
  const parts = [type, situation].filter((v): v is string => Boolean(v));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Ascending by `distance`, undefined sorted last: "closest first" for
 * every category and the Suggested selection built from them. */
function sortByDistance(list: readonly TargetListEntry[]): TargetListEntry[] {
  return [...list].sort((a, b) => {
    const da = a.distance ?? Number.POSITIVE_INFINITY;
    const db = b.distance ?? Number.POSITIVE_INFINITY;
    return da - db;
  });
}

/** Native per-topic stream status (copy of DistanceToTarget/OrbitView's
 * helper): `"disconnected"` when no `TelemetryProvider` is mounted. */
function useStreamStatusOptional(topic: string): StreamStatusValue {
  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!client || !store) return () => {};
      const inputTopics = store.resolveSubscriptionTopics(topic);
      const unsubscribeInputs = inputTopics.map((inputTopic) =>
        client.subscribe(inputTopic, () => {}),
      );
      const unsubscribeFrame = store.subscribeFrame(onStoreChange);
      return () => {
        unsubscribeFrame();
        for (const unsubscribe of unsubscribeInputs) unsubscribe();
      };
    },
    [client, store, topic],
  );
  const getSnapshot = useCallback((): StreamStatusValue => {
    if (!store) return "disconnected";
    return store.sampleStatus(topic, store.currentFrame());
  }, [store, topic]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

function TargetPickerComponent({
  w,
  h,
}: Readonly<ComponentProps<TargetPickerConfig>>) {
  // Canonical native reads: the whole `target.available` list, and the
  // target-detail scalars off the whole `vessel.target` Topic (name, kind,
  // and the Vec3 fields distance/Δv derive from), the same native-shim
  // reads DistanceToTarget uses, not the `vessel.state` derived channel
  // (which isn't a wire Topic and so can't be declared in
  // `dataRequirements`: see the ratchet test in
  // `packages/core/src/hooks/mapTopic.coverage.test.ts`).
  const available = useTelemetry("target.available");
  const target = useTelemetry("vessel.target");
  const tarName = resolveTargetName(target?.name);
  const tarType = targetKindLabel(target?.kind);
  const tarRelPos = target?.relativePosition as Vec3 | undefined;
  const tarRelVelVec = target?.relativeVelocity as Vec3 | undefined;
  const tarDistance = tarRelPos ? vecMagnitude(tarRelPos) : undefined;
  const tarRelVel =
    tarRelPos && tarRelVelVec
      ? radialSpeed(tarRelPos, tarRelVelVec)
      : undefined;
  const execute = useExecuteAction("data");

  const [filter, setFilter] = useState("");
  const [showSpaceObjects, setShowSpaceObjects] = useState(false);
  const [bodiesExpanded, setBodiesExpanded] = useState(true);
  const [vesselsExpanded, setVesselsExpanded] = useState(true);
  const [partsExpanded, setPartsExpanded] = useState(true);
  const [otherExpanded, setOtherExpanded] = useState(true);

  useActionInput<TargetPickerActions>({
    "clear-target": (payload) => {
      if (payload.kind !== "button" || payload.value !== true) return;
      void execute("tar.clearTarget");
    },
  });

  // Pending state, which row is awaiting the `vessel.target` readback after
  // a click. We render a spinner on that row until the readback confirms (or
  // a 5 s safety net clears it). `id` is `entryId(entry)`, so a Suggested row
  // and its category-section twin (the same underlying entry, rendered
  // twice) both light up together.
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
    if (entry.kind === TargetKind.Body) {
      if (entry.bodyIndex === undefined) return;
      setPendingTarget({ id, expectedName: entry.name, since: Date.now() });
      void execute(`tar.setTargetBody[${entry.bodyIndex}]`);
    } else if (entry.kind === TargetKind.Vessel) {
      if (!entry.vesselId) return;
      setPendingTarget({ id, expectedName: entry.name, since: Date.now() });
      void execute(`tar.setTargetVessel[${entry.vesselId}]`);
    } else if (entry.kind === TargetKind.Part) {
      if (!entry.vesselId || entry.partId === undefined) return;
      setPendingTarget({ id, expectedName: entry.name, since: Date.now() });
      void execute(`tar.setTargetPart[${entry.vesselId},${entry.partId}]`);
    }
    // T1: an `Other`/unknown-kind entry (a modded ITargetable) has no id-based
    // `tar.setTarget*` command to re-select it: the producer only surfaces one
    // when it's ALREADY the current target: so a click is intentionally a
    // graceful no-op here (the row still shows name + distance + the TARGET
    // tag). Documented so this fall-through reads as deliberate, not an
    // accidental missing branch.
  };
  const clearTarget = () => {
    setPendingTarget(null);
    void execute("tar.clearTarget");
  };

  // ── target.available -> Suggested + categorised sections ─────────────────
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

  // Asteroid/comet toggle applies to Vessel-kind entries only (Bodies/Parts
  // are unaffected, a Part's vesselType is its owning vessel's, but the
  // toggle is scoped to the Vessels category + Suggested vessels per spec).
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
  // T1: anything that isn't a Body/Vessel/Part: `TargetKind.Other` (a modded
  // ITargetable the producer surfaces as the current target) or any kind the
  // consumer doesn't recognise: buckets here rather than falling into no list
  // and rendering invisibly. Distance is kind-agnostic (every ITargetable has
  // a transform), so it shows + distance-sorts like the others.
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

  // Suggested: 2 closest Bodies + 2 closest Vessels + ALL Parts (already
  // off-vessel by construction): each source list is already closest-first.
  const suggested = useMemo(
    () => [...bodiesList.slice(0, 2), ...vesselsList.slice(0, 2), ...partsList],
    [bodiesList, vesselsList, partsList],
  );

  const noCategoriesHaveEntries =
    bodiesList.length === 0 &&
    vesselsList.length === 0 &&
    partsList.length === 0 &&
    otherList.length === 0;

  // Selective rendering: at very small sizes the picker doesn't have room,
  // so collapse to a current-target readout (clear button if there's any width).
  const cols = w ?? 6;
  const rows = h ?? 11;
  const showFull = rows >= 6 && cols >= 4;

  if (!showFull) {
    return (
      <Panel
        panelTitle="TARGET"
        panelAside={<AugmentSlot name="target-picker.badges" props={{}} />}
      >
        <CompactCurrent>
          {tarName ? (
            <>
              <CompactName>{tarName}</CompactName>
              {typeof tarDistance === "number" &&
                Number.isFinite(tarDistance) && (
                  <CompactDistance>
                    {formatDistance(tarDistance)}
                  </CompactDistance>
                )}
            </>
          ) : (
            <Hint>No target set</Hint>
          )}
        </CompactCurrent>
      </Panel>
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
          {entry.distance === undefined
            ? NULL_DISPLAY
            : formatDistance(entry.distance)}
        </RowDistance>
        {isPending && <Spinner ariaLabel="Setting target" />}
        {!isPending && entry.isCurrent && <RowTag>TARGET</RowTag>}
      </Row>
    );
  };

  return (
    <Panel
      panelTitle="TARGET PICKER"
      panelAside={<AugmentSlot name="target-picker.badges" props={{}} />}
    >
      <OrbitalEventChipsRow>
        <OrbitalEventChips />
      </OrbitalEventChipsRow>
      <CurrentSummary>
        {tarName === undefined ? (
          <Hint>No target set in KSP.</Hint>
        ) : (
          <>
            <CurrentSummaryTop>
              <CurrentSummaryName title={tarName}>{tarName}</CurrentSummaryName>
              {typeof tarDistance === "number" &&
                Number.isFinite(tarDistance) && (
                  <CurrentSummaryDistance>
                    {formatDistance(tarDistance)}
                  </CurrentSummaryDistance>
                )}
            </CurrentSummaryTop>
            <CurrentSummaryMeta>
              {tarType && <span>{tarType}</span>}
              {typeof tarRelVel === "number" && Number.isFinite(tarRelVel) && (
                <span>Δv {tarRelVel.toFixed(2)} m/s</span>
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
      {/* Host slot for a fleet-management Uplink's filter/grouping section,
          rendered below the stock sections. Empty (renders no DOM) until an
          augment binds `target-picker.sections`; the wrapper collapses to
          zero height so the widget's own layout is untouched when unfilled. */}
      <AugmentSectionsRow>
        <AugmentSlot name="target-picker.sections" props={{}} />
      </AugmentSectionsRow>
    </Panel>
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

/** A real disclosure pattern: a `<button>` heading toggling the section,
 * `aria-expanded` + `aria-controls` wired to the collapsible body's id. */
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

// ── Config component ──────────────────────────────────────────────────────────

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
          target; use Clear in the header to drop it.
        </FieldHint>
      </Field>
    </ConfigForm>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

/** Chip row that collapses to zero height when there's no encounter / apsis
 *  data: keeps the header tight in the common steady-orbit case. */
const OrbitalEventChipsRow = styled.div`
  display: flex;
  &:empty {
    display: none;
  }
`;

/** Wraps the `target-picker.sections` augment slot. Collapses to zero height
 *  when no augment is bound (the slot renders no DOM), keeping the stock layout
 *  identical to before the slot existed. */
const AugmentSectionsRow = styled.div`
  display: flex;
  flex-direction: column;
  margin-top: var(--space-6);
  &:empty {
    display: none;
  }
`;

const CurrentSummary = styled.div`
  margin-top: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
`;

const CurrentSummaryTop = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-8);
`;

const CurrentSummaryName = styled.span`
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-status-go-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
`;

const CurrentSummaryDistance = styled.span`
  font-size: var(--font-size-sm);
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
`;

const CurrentSummaryMeta = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-10);
  font-size: var(--font-size-2xs);
  color: var(--color-text-muted);
  letter-spacing: 0.04em;
`;

const FilterInput = styled.input`
  margin-top: var(--space-6);
  font-size: var(--font-size-sm);
  padding: var(--space-4) var(--space-6);
  background: var(--color-surface-app);
  border: 1px solid var(--color-surface-raised);
  border-radius: var(--radius-xs);
  color: var(--color-text-primary);
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const ListScroll = styled(ScrollArea)`
  flex: 1;
  margin-top: var(--space-6);
  [data-scroll-area-inner] {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }
`;

const SuggestedHeading = styled.div`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  padding: var(--space-2) var(--space-4);
`;

const SectionHeaderRow = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-6);
`;

const SectionToggle = styled.button`
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  padding: var(--space-2) var(--space-4);
  font-size: var(--font-size-2xs);
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
  gap: var(--space-hair);
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
  font-size: var(--font-size-2xs);
  color: currentColor;
  opacity: 0.7;
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

const RowDistance = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  margin-right: var(--space-6);
  flex-shrink: 0;
`;

const RowTag = styled.span`
  font-size: var(--font-size-2xs);
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--color-status-go-fg);
`;

const SpaceObjectToggle = styled.button`
  margin-left: auto;
  font-size: var(--font-size-2xs);
  padding: var(--space-2) var(--space-8);
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
  margin-top: var(--space-6);
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
  line-height: var(--line-height-body);
`;

const CompactCurrent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  text-align: center;
`;

const CompactName = styled.div`
  font-size: var(--font-size-base);
  font-weight: 700;
  color: var(--color-text-primary);
  letter-spacing: 0.04em;
`;

const CompactDistance = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-accent-fg);
  letter-spacing: 0.04em;
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<TargetPickerConfig>({
  id: "target-picker",
  name: "Target Picker",
  description:
    "Pick a target from a single Suggested + categorised list (Bodies / Vessels / Parts) driven by the `target.available` channel, or inspect the current target's name / type / distance / Δv with a clear button in the header.",
  tags: ["telemetry", "navigation"],
  defaultSize: { w: 6, h: 11 },
  minSize: { w: 3, h: 3 },
  component: TargetPickerComponent,
  configComponent: TargetPickerConfigComponent,
  // Two host-owned augment slots: a body `.sections` slot for a
  // fleet-management Uplink's filter/grouping view, and the broad `.badges`
  // escape hatch in the header. Unfilled until an Uplink binds them.
  augmentSlots: ["target-picker.sections", "target-picker.badges"],
  dataRequirements: ["target.available", "vessel.target"],
  defaultConfig: {},
  actions: targetPickerActions,
  pushable: true,
  requires: ["flight"],
});

// Test-only surface for the T3 drift-guard (`enumLabelDrift.test.ts`), aliased
// rather than exported bare, since LaunchDirector declares an identically-named
// `VESSEL_TYPE_LABELS` const of its own and the package barrel (`src/index.ts`)
// re-exports every widget's `*`, which would otherwise collide.
export {
  SITUATION_LABELS as TARGET_PICKER_SITUATION_LABELS,
  TargetPickerComponent,
  VESSEL_TYPE_LABELS as TARGET_PICKER_VESSEL_TYPE_LABELS,
};
