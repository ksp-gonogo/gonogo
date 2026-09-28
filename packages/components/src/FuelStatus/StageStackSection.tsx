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
import { budgetFigure, fmtFixed, pickDeltaV, pickTWR } from "./deltaV";

function burnLabel(burnTime: number): ReactNode {
  // NaN is a burn time the wire did not carry, not a stage that burns for no time.
  if (!Number.isFinite(burnTime)) return NULL_DISPLAY;
  if (burnTime > 0) return <Unit value={value("s", burnTime)} />;
  return "0s";
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
  return (
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
      <MeterStack>
        {stages.map((s) => {
          const figure = pickDeltaV(s, mode);
          // NaN is a stage the wire carried no ΔV for, which the meter draws as absent rather than empty.
          const dv = Number.isFinite(figure)
            ? budgetFigure(budgetReading, value("m/s", figure))
            : null;
          const active = s.stage === currentStage;
          return (
            <MeterRowGroup key={s.stage}>
              <Meter
                label={`${active ? "▶ " : ""}S${s.stage}`}
                value={dv}
                capacity={maxStageDv}
                layout="row"
                fillColor={
                  active ? "var(--color-warn-mark)" : "var(--color-text-faint)"
                }
                valueLabel={
                  dv === null ? undefined : speakQuantity(value("m/s", figure))
                }
                valueLabelNode={
                  dv === null ? undefined : <Unit value={dv} decimals={0} />
                }
              />
              <Text
                size="xs"
                style={{
                  justifySelf: "end",
                  whiteSpace: "nowrap",
                  color: active
                    ? "var(--color-nogo-text)"
                    : "var(--color-text-faint)",
                }}
              >
                {burnLabel(s.burnTime)} · TWR {fmtFixed(pickTWR(s, mode), 2)}
              </Text>
            </MeterRowGroup>
          );
        })}
      </MeterStack>
    </Stack>
  );
}
