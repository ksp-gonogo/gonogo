import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Box,
  NULL_DISPLAY,
  ReadoutCaption,
  Stack,
  Text,
  Unit,
  type UnitValue,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { DELTA_V_MODE_SHORT, type DeltaVMode } from "./config";

function TotalFigure({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Stack>
      <ReadoutCaption
        style={{
          color: "var(--color-text-faint)",
          letterSpacing: "0.1em",
        }}
      >
        {label}
      </ReadoutCaption>
      <Text
        tone="default"
        size="sm"
        style={{
          display: "inline-flex",
          alignItems: "baseline",
          gap: "var(--gap-related)",
          flexWrap: "wrap",
          fontWeight: 700,
          color: "var(--color-status-nogo-fg)",
        }}
      >
        {children}
      </Text>
    </Stack>
  );
}

/** The game's vessel-total ΔV and burn time, side by side. */
export function TotalsSection({
  totalDv,
  totalBurnTime,
  mode,
}: {
  totalDv: number | undefined;
  /** `null` when the sim reported no figure, so it still goes through `Unit` rather than the bare-string branch. */
  totalBurnTime: UnitValue<"s"> | null | undefined;
  mode: DeltaVMode;
}) {
  return (
    <Box
      surface="panel"
      bordered
      radius="regular"
      style={{
        display: "flex",
        gap: "var(--gap-section)",
        padding: "var(--inset-surface)",
      }}
    >
      <TotalFigure label="Total ΔV">
        <span style={{ whiteSpace: "nowrap" }}>
          {totalDv !== undefined
            ? writeQuantity(value("m/s", totalDv), { decimals: 0 })
            : NULL_DISPLAY}
        </span>
        <span
          style={{
            color: "var(--color-text-dim)",
            fontSize: "var(--font-size-caption)",
            letterSpacing: "0.08em",
          }}
        >
          {DELTA_V_MODE_SHORT[mode]}
        </span>
      </TotalFigure>
      <TotalFigure label="Total burn">
        <span style={{ whiteSpace: "nowrap" }}>
          {totalBurnTime !== undefined ? (
            <Unit value={totalBurnTime} />
          ) : (
            NULL_DISPLAY
          )}
        </span>
      </TotalFigure>
    </Box>
  );
}
