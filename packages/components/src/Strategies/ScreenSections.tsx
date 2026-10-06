import {
  type CarriedCurrency,
  datedFrom,
  staticValue,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  AugmentSlot,
  CommandButton,
  type CommandButtonHandle,
  Divider,
  Grid,
  ScrollArea,
  Section,
  Slider,
  Stack,
  Unit,
  useSlotBound,
} from "@ksp-gonogo/ui-kit";
import type { Dispatch, SetStateAction } from "react";
import { magnitudeOf, type Quantityish } from "../shared/magnitude";
import { AvailableRow, StrategyDescription } from "./AvailableRow";
import { parseEffectLines } from "./parsing";
import { partition, sharedReason } from "./partition";
import { ShortRow, type ShortState } from "./ShortForm";
import {
  BlockedNote,
  CardDept,
  EffectLine,
  EffectList,
  Empty,
  FactorLabel,
  FactorRow,
  FactorTag,
  FactorValue,
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
  /** False for a screen naming no departments: chrome for its augment body, no Active/Available/Locked sections. */
  listsStrategies?: boolean;
  /** True when the screen's own body carries the activate/deactivate verbs, so the host draws no Activate/Deactivate button on its cards. */
  drawsOwnActions?: boolean;
  /** Draw one line per strategy instead of the Active / Available / Locked cards, for a tile too short for them. */
  short?: boolean;
  /** The career's activation is the game's own, so a strategy with no verdict is checked in full when it is confirmed. */
  checkedOnConfirm: boolean;
  funds: Quantityish | undefined;
  reputation: Quantityish | undefined;
  science: Quantityish | undefined;
  rosterFrom: readonly CarriedCurrency[];
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
  listsStrategies = true,
  drawsOwnActions = false,
  short = false,
  checkedOnConfirm,
  funds,
  reputation,
  science,
  rosterFrom,
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
  const fundsNow = magnitudeOf(funds);
  const reputationNow = magnitudeOf(reputation);
  const scienceNow = magnitudeOf(science);
  const bodyBound = useSlotBound("strategies.screen-body");
  // The available card and the unanswered one are the same card; only the note differs.
  const strategyRow = (s: Strategy, note?: string) => (
    <AvailableRow
      key={s.id}
      strategy={s}
      showDepartment={showDepartment}
      funds={fundsNow}
      reputation={reputationNow}
      science={scienceNow}
      rosterFrom={rosterFrom}
      factor={factorById[s.id] ?? s.factorSliderDefault}
      onFactorChange={(v) => setFactorById((prev) => ({ ...prev, [s.id]: v }))}
      activateCmd={activateCmd}
      drawsOwnActions={drawsOwnActions}
      expanded={expandedId === s.id}
      onToggleExpanded={() => setExpandedId(expandedId === s.id ? null : s.id)}
      note={note}
    />
  );
  const shortRow = (s: Strategy, state: ShortState) => (
    <ShortRow
      key={s.id}
      strategy={s}
      state={state}
      expanded={expandedId === s.id}
      onToggleExpanded={() => setExpandedId(expandedId === s.id ? null : s.id)}
      funds={fundsNow}
      reputation={reputationNow}
      science={scienceNow}
      rosterFrom={rosterFrom}
      factor={factorById[s.id] ?? s.factorSliderDefault}
      activateCmd={activateCmd}
      deactivateCmd={deactivateCmd}
      drawsOwnActions={drawsOwnActions}
      details={
        <>
          <StrategyDescription of={s} />
          <EffectList>
            {parseEffectLines(s.effect).map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static effect text, never reordered
              <EffectLine key={`${i}:${line}`}>{line}</EffectLine>
            ))}
          </EffectList>
          {(state.kind === "available" || state.kind === "unchecked") &&
            !drawsOwnActions &&
            s.hasFactorSlider && (
              <FactorRow>
                <FactorLabel>Factor</FactorLabel>
                <Slider
                  min={s.factorSliderDefault}
                  max={1}
                  step={
                    (1 - s.factorSliderDefault) /
                    Math.max(s.factorSliderSteps, 1)
                  }
                  value={factorById[s.id] ?? s.factorSliderDefault}
                  onChange={(e) =>
                    setFactorById((prev) => ({
                      ...prev,
                      [s.id]: Number.parseFloat(e.target.value),
                    }))
                  }
                  aria-label={`Commitment factor for ${s.title}`}
                />
                <FactorValue>
                  <Unit
                    value={staticValue(
                      "%",
                      (factorById[s.id] ?? s.factorSliderDefault) * 100,
                    )}
                    decimals={0}
                  />
                </FactorValue>
              </FactorRow>
            )}
        </>
      }
    />
  );
  if (short && listsStrategies) {
    const none =
      active.length +
        available.length +
        softBlocked.length +
        ineligible.length +
        unknown.length ===
      0;
    return (
      <ScrollArea>
        <ScreenInset data-strategies-screen-inset="">
          {none ? (
            <Empty>No strategies</Empty>
          ) : (
            <Stack
              as="ul"
              gap="related-dense"
              style={{ margin: 0, padding: 0 }}
            >
              {active.map((s) => shortRow(s, { kind: "active" }))}
              {available.map((s) => shortRow(s, { kind: "available" }))}
              {unknown.map((s) =>
                shortRow(s, {
                  kind: "unchecked",
                  reason: unknownReason ?? s.activateBlockedReason,
                }),
              )}
              {softBlocked.map((s) =>
                shortRow(s, {
                  kind: "locked",
                  reason:
                    "Deactivate the running strategy first to enable this one.",
                }),
              )}
              {ineligible.map((s) =>
                shortRow(s, {
                  kind: "locked",
                  reason: s.activateBlockedReason,
                }),
              )}
            </Stack>
          )}
          {screenId !== undefined && (
            <AugmentSlot name="strategies.screen-body" props={{ screenId }} />
          )}
        </ScreenInset>
      </ScrollArea>
    );
  }
  return (
    <ScrollArea>
      {/* One box owns the whole screen's inset, the augment included. */}
      <ScreenInset data-strategies-screen-inset="">
        {/* A screen naming no departments lists nothing: it is chrome for its augment body. */}
        {listsStrategies && (
          // Panel's own columnising, rebuilt: the tabbed body is one full section, which never columnises.
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
                          <Unit
                            value={datedFrom(
                              rosterFrom,
                              value("%", s.factor * 100),
                            )}
                            decimals={0}
                          />
                        </FactorTag>
                        {!drawsOwnActions && (
                          <CommandButton
                            handle={deactivateCmd}
                            args={{ strategyId: s.id }}
                            commandLabel={`Deactivate ${s.title}`}
                            label="Deactivate"
                            confirmLabel="Confirm deactivate"
                            confirmTone="nogo"
                            pendingLabel="Deactivating..."
                            title="Deactivate this strategy"
                          />
                        )}
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
                        Deactivate the running strategy first to enable this
                        one.
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
                {checkedOnConfirm && !drawsOwnActions && (
                  <BlockedNote>
                    The checks that could not be made here are made when you
                    confirm.
                  </BlockedNote>
                )}
                {unknown.map((s) =>
                  strategyRow(
                    s,
                    unknownReason === null
                      ? s.activateBlockedReason
                      : undefined,
                  ),
                )}
              </Section>
            )}
          </Grid>
        )}

        {/* Outside the grid: an augment columnises its own sections against the full width. */}
        {screenId !== undefined && (
          <>
            {bodyBound && listsStrategies && <Divider />}
            <AugmentSlot name="strategies.screen-body" props={{ screenId }} />
          </>
        )}
      </ScreenInset>
    </ScrollArea>
  );
}
