import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  AugmentSlot,
  CommandButton,
  type CommandButtonHandle,
  Divider,
  Grid,
  ScrollArea,
  Section,
  Unit,
  useSlotBound,
} from "@ksp-gonogo/ui-kit";
import type { Dispatch, SetStateAction } from "react";
import { magnitudeOf, type Quantityish } from "../shared/magnitude";
import { AvailableRow, StrategyDescription } from "./AvailableRow";
import { parseEffectLines } from "./parsing";
import { partition, sharedReason } from "./partition";
import {
  BlockedNote,
  CardDept,
  EffectLine,
  EffectList,
  Empty,
  FactorTag,
  SCREEN_COLUMNS,
  ScreenInset,
  StrategyCard,
} from "./styles";
import type { Strategy } from "./types";

/**
 * Everything a screen needs to draw its share of the list. The state is held
 * by the widget, so switching screens keeps a half-set factor slider and an
 * armed button where the operator left them.
 */
export interface ScreenSectionsProps {
  strategies: readonly Strategy[];
  /** Absent for the ungrouped widget. */
  screenId?: string;
  /** Whether each card names its department; false on a screen that is one department. */
  showDepartment?: boolean;
  /** Whether `career.strategy.activate` can commit a strategy the roster has no verdict for. */
  commitsUnanswered: boolean;
  funds: Quantityish | undefined;
  reputation: Quantityish | undefined;
  science: Quantityish | undefined;
  balancesHeld: boolean;
  factorById: Record<string, number>;
  setFactorById: Dispatch<SetStateAction<Record<string, number>>>;
  activateCmd: CommandButtonHandle;
  deactivateCmd: CommandButtonHandle;
  expandedId: string | null;
  setExpandedId: Dispatch<SetStateAction<string | null>>;
}

/**
 * One screenful of strategies: the Active / Available / Locked lists, plus
 * whatever an Uplink has bound to this screen's body. The ungrouped widget has
 * no `screenId` and so no body slot.
 */
export function ScreenSections({
  strategies,
  screenId,
  showDepartment = true,
  commitsUnanswered,
  funds,
  reputation,
  science,
  balancesHeld,
  factorById,
  setFactorById,
  activateCmd,
  deactivateCmd,
  expandedId,
  setExpandedId,
}: Readonly<ScreenSectionsProps>) {
  const { active, available, softBlocked, ineligible, unknown } =
    partition(strategies);
  const unknownReason = sharedReason(unknown);
  const bodyBound = useSlotBound("strategies.screen-body");
  // The available card and the unanswered one are the same card; only the note differs.
  const strategyRow = (s: Strategy, note?: string) => (
    <AvailableRow
      key={s.id}
      strategy={s}
      showDepartment={showDepartment}
      commitsUnanswered={commitsUnanswered}
      funds={magnitudeOf(funds)}
      reputation={magnitudeOf(reputation)}
      science={magnitudeOf(science)}
      balancesHeld={balancesHeld}
      factor={factorById[s.id] ?? s.factorSliderDefault}
      onFactorChange={(v) => setFactorById((prev) => ({ ...prev, [s.id]: v }))}
      activateCmd={activateCmd}
      expanded={expandedId === s.id}
      onToggleExpanded={() => setExpandedId(expandedId === s.id ? null : s.id)}
      note={note}
    />
  );
  return (
    <ScrollArea>
      {/* One box owns the whole screen's inset, the augment included. */}
      <ScreenInset data-strategies-screen-inset="">
        {/* Panel's own columnising, rebuilt: the tabbed body is one full section, which never columnises. */}
        <Grid cols={SCREEN_COLUMNS} gap="related-comfortable" align="start">
          <Section
            as="section"
            aria-label="Active"
            title="Active"
            gap="related-comfortable"
          >
            {active.length === 0 ? (
              <Empty>No active strategies</Empty>
            ) : (
              active.map((s) => (
                <StrategyCard
                  key={s.id}
                  $active
                  title={s.title}
                  titleRight={
                    showDepartment ? (
                      <CardDept>{s.departmentName}</CardDept>
                    ) : undefined
                  }
                  footer={
                    <>
                      <FactorTag>
                        factor{" "}
                        <Unit value={value("%", s.factor * 100)} decimals={0} />
                      </FactorTag>
                      <CommandButton
                        handle={deactivateCmd}
                        args={{ strategyId: s.id }}
                        commandLabel={`Deactivate ${s.title}`}
                        label="Deactivate"
                        confirmLabel="Confirm deactivate"
                        pendingLabel="Deactivating..."
                        active
                        tone="go"
                        disabled={!s.canDeactivate}
                        title={
                          s.canDeactivate
                            ? "Deactivate this strategy"
                            : s.deactivateBlockedReason || "Cannot deactivate"
                        }
                      />
                    </>
                  }
                >
                  <StrategyDescription of={s} />
                  <EffectList>
                    {parseEffectLines(s.effect).map((line, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: static effect text, never reordered
                      <EffectLine key={`${i}:${line}`}>{line}</EffectLine>
                    ))}
                  </EffectList>
                </StrategyCard>
              ))
            )}
          </Section>

          <Section
            as="section"
            aria-label="Available"
            title="Available"
            gap="related-comfortable"
          >
            {available.length === 0 && softBlocked.length === 0 ? (
              <Empty>No strategies available right now</Empty>
            ) : (
              <>
                {available.map((s) => strategyRow(s))}
                {softBlocked.map((s) => (
                  <StrategyCard
                    key={s.id}
                    title={s.title}
                    titleRight={
                      showDepartment ? (
                        <CardDept>{s.departmentName}</CardDept>
                      ) : undefined
                    }
                  >
                    <BlockedNote>
                      Deactivate the running strategy first to enable this one.
                    </BlockedNote>
                  </StrategyCard>
                ))}
              </>
            )}
          </Section>

          {ineligible.length > 0 && (
            <Section
              as="section"
              aria-label="Locked"
              title="Locked"
              gap="related-comfortable"
            >
              {ineligible.map((s) => (
                <StrategyCard
                  key={s.id}
                  title={s.title}
                  titleRight={
                    showDepartment ? (
                      <CardDept>{s.departmentName}</CardDept>
                    ) : undefined
                  }
                >
                  <BlockedNote>{s.activateBlockedReason}</BlockedNote>
                </StrategyCard>
              ))}
            </Section>
          )}

          {/* Not part of Locked: a refusal is a fact about the save, an unknown is a reading that could not be taken. */}
          {unknown.length > 0 && (
            <Section
              as="section"
              aria-label="Eligibility unknown"
              title="Eligibility unknown"
              gap="related-comfortable"
            >
              {unknownReason !== null && (
                <BlockedNote>{unknownReason}</BlockedNote>
              )}
              {unknown.map((s) =>
                strategyRow(
                  s,
                  unknownReason === null ? s.activateBlockedReason : undefined,
                ),
              )}
            </Section>
          )}
        </Grid>

        {/* Outside the grid: an augment columnises its own sections against the full width. */}
        {screenId !== undefined && (
          <>
            {bodyBound && <Divider />}
            <AugmentSlot name="strategies.screen-body" props={{ screenId }} />
          </>
        )}
      </ScreenInset>
    </ScrollArea>
  );
}
