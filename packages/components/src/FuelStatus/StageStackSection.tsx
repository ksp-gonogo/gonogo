import type { DeltaVBudget, DeltaVStage } from "@ksp-gonogo/sitrep-client";
import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Meter,
  MeterRowGroup,
  MeterStack,
  NULL_DISPLAY,
  ReadoutCaption,
  Stack,
  speakQuantity,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { DELTA_V_MODE_SHORT, type DeltaVMode } from "./config";
import { budgetFigure, pickDeltaV, pickTWR } from "./deltaV";
import { useFittedRows } from "./useFittedRows";

function burnLabel(
  budgetReading: Reading<DeltaVBudget>,
  burnTime: number,
  deltaV: number,
): ReactNode {
  // NaN is a burn time the wire did not carry, not a stage that burns for no time.
  if (!Number.isFinite(burnTime)) return NULL_DISPLAY;
  // A spent stage has nothing left to burn, whatever time its tanks would still sum to.
  if (deltaV === 0) return NULL_DISPLAY;
  return <Unit value={budgetFigure(budgetReading, value("s", burnTime))} />;
}

/** A stage's thrust-to-weight ratio, dated as the budget it is part of. */
function twrLabel(
  budgetReading: Reading<DeltaVBudget>,
  twr: number,
): ReactNode {
  if (!Number.isFinite(twr)) return NULL_DISPLAY;
  return (
    <Unit value={budgetFigure(budgetReading, value("1", twr))} decimals={2} />
  );
}

/**
 * Per-stage ΔV, burn and TWR, current stage highlighted. Each bar is the stage's
 * ΔV against the largest stage's, and carries the budget reading's currency, so
 * a held budget draws held bars.
 */
export function StageStackSection({
  budgetReading,
  stages,
  mode,
  currentStage,
  maxStageDv,
}: {
  budgetReading: Reading<DeltaVBudget>;
  stages: DeltaVStage[];
  mode: DeltaVMode;
  currentStage: number | undefined;
  maxStageDv: Value<"m/s">;
}) {
  /*
   * A tile with room for fewer rows than there are stages draws from the
   * current stage down, since the stages above it are spent, and counts the
   * rest.
   */
  const first = Math.max(
    0,
    stages.findIndex((s) => s.stage === currentStage),
  );
  const { blockRef, listRef, fitted, noteFits } = useFittedRows(stages.length);
  const collapsed = fitted === 0;
  const shown =
    fitted === null || collapsed ? stages : stages.slice(first, first + fitted);
  const leftOut = stages.length - shown.length;
  return (
    <div ref={blockRef}>
      {/* A block with no room draws nothing but keeps its place, so growing the tile can bring it back. */}
      {!collapsed && (
        <Stack>
          <ReadoutCaption
            style={{
              color: "var(--color-text-faint)",
              letterSpacing: "0.1em",
              marginBottom: "var(--gap-under-title)",
            }}
          >
            Stages · ΔV ({DELTA_V_MODE_SHORT[mode]}) · burn · TWR
          </ReadoutCaption>
          <div ref={listRef}>
            <MeterStack>
              {shown.map((s) => {
                const figure = pickDeltaV(s, mode);
                // NaN is a stage the wire carried no ΔV for, which the meter draws as absent rather than empty.
                const dv = Number.isFinite(figure)
                  ? budgetFigure(budgetReading, value("m/s", figure))
                  : null;
                // A stage with no ΔV left is finished, so it is not the one burning.
                const active = s.stage === currentStage && figure !== 0;
                return (
                  <MeterRowGroup key={s.stage}>
                    <Meter
                      label={`${active ? "▶ " : ""}S${s.stage}`}
                      value={dv}
                      capacity={maxStageDv}
                      layout="row"
                      fillColor={
                        active
                          ? "var(--color-warn-mark)"
                          : "var(--color-text-faint)"
                      }
                      valueLabel={
                        dv === null
                          ? undefined
                          : speakQuantity(value("m/s", figure))
                      }
                      valueLabelNode={
                        dv === null ? undefined : (
                          <Unit value={dv} decimals={0} />
                        )
                      }
                    />
                    <Text
                      size="xs"
                      style={{
                        justifySelf: "end",
                        whiteSpace: "nowrap",
                        color: active
                          ? "var(--color-text-primary)"
                          : "var(--color-text-faint)",
                      }}
                    >
                      {burnLabel(budgetReading, s.burnTime, figure)} · TWR{" "}
                      {twrLabel(budgetReading, pickTWR(s, mode))}
                    </Text>
                  </MeterRowGroup>
                );
              })}
            </MeterStack>
          </div>
          {leftOut > 0 && noteFits && (
            <Text
              size="xs"
              style={{
                justifySelf: "end",
                color: "var(--color-text-faint)",
              }}
            >
              +{leftOut} more {leftOut === 1 ? "stage" : "stages"}
            </Text>
          )}
        </Stack>
      )}
    </div>
  );
}
