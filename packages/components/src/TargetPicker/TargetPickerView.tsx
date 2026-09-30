import type { ComponentProps } from "@ksp-gonogo/core";
import { useActionInput } from "@ksp-gonogo/core";
import { useCommand, withoutReckoning } from "@ksp-gonogo/sitrep-client";
import { stillTrue, type TargetListEntry } from "@ksp-gonogo/sitrep-sdk";
import { Panel, Section, Unit } from "@ksp-gonogo/ui-kit";
import { useEffect, useMemo, useState } from "react";
import {
  bare,
  closingRateReading,
  radialSpeed,
  rangeReading,
  targetKindLabel,
  vecMagnitude,
} from "../shared/dockAngles";
import { OrbitalEventChips } from "../shared/OrbitalEventChips";
import { rosterDistance } from "../shared/rosterDistance";
import { CategorySection } from "./CategorySection";
import { CurrentTargetSummary } from "./CurrentTargetSummary";
import type { TargetPickerActions, TargetPickerConfig } from "./config";
import { entryId, targetArgsFor } from "./entries";
import {
  CompactCurrent,
  CompactDistance,
  CompactName,
  FilterBox,
  Hint,
  ListScroll,
  OrbitalEventChipsRow,
  SectionBody,
  SpaceObjectToggle,
  SuggestedHeading,
} from "./styles";
import { TargetRow } from "./TargetRow";
import { targetPickerTopics } from "./topics";
import { useRosterCategories } from "./useRosterCategories";

/** What a confirmed-no-targets tombstone means: a roster, and it is empty. */
const EMPTY_ROSTER = { entries: [] as TargetListEntry[] };

export function TargetPickerComponent({
  w,
  h,
}: Readonly<ComponentProps<TargetPickerConfig>>) {
  /**
   * The roster and the current target are facts, so both take `stillTrue`: a
   * held target is what we last told the craft and what it last confirmed.
   */
  const availableReading = targetPickerTopics.useTelemetry("target.available");
  // A confirmed empty sky IS an empty roster; only `pending` renders the wait.
  const available = stillTrue(availableReading, EMPTY_ROSTER);
  const distanceOf = useMemo(
    () => rosterDistance(availableReading),
    [availableReading],
  );
  // The model is dropped: a picker offering a modelled range beside a name is the confident-wrong picture.
  const targetReading = targetPickerTopics.useTelemetry("vessel.target");
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
    const args = targetArgsFor(entry);
    if (args === null) return;
    setPendingTarget({
      id: entryId(entry),
      expectedName: entry.name,
      since: Date.now(),
    });
    void setTargetCmd.send(args, { label: `Target ${entry.name}` });
  };
  const clearTarget = () => {
    setPendingTarget(null);
    void clearTargetCmd.send(undefined, { label: "Clear target" });
  };

  const entries = available?.entries ?? [];
  const {
    isFiltering,
    spaceObjectCount,
    bodiesList,
    vesselsList,
    partsList,
    otherList,
    suggested,
    noCategoriesHaveEntries,
  } = useRosterCategories(
    entries,
    filter.trim().toLowerCase(),
    showSpaceObjects,
  );

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

  const renderRow = (entry: TargetListEntry, keyPrefix: string) => (
    <TargetRow
      key={`${keyPrefix}:${entryId(entry)}`}
      entry={entry}
      distance={distanceOf(entry)}
      isPending={pendingTarget?.id === entryId(entry)}
      onPick={dispatchTarget}
    />
  );

  return (
    <Panel
      panelTitle="TARGET PICKER"
      sections={[
        <Section key="summary" full>
          <OrbitalEventChipsRow>
            <OrbitalEventChips />
          </OrbitalEventChipsRow>
          <CurrentTargetSummary
            tarName={tarName}
            tarType={tarType}
            tarDistance={tarDistance}
            tarRelVel={tarRelVel}
            rangeR={rangeR}
            closingRateR={closingRateR}
            onClear={clearTarget}
          />
          <FilterBox
            placeholder="Filter targets"
            value={filter}
            onChange={setFilter}
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
