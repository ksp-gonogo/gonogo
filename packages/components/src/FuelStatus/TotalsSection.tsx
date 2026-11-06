import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import {
  Box,
  Grid,
  NULL_DISPLAY,
  ReadoutCaption,
  Stack,
  Text,
  Unit,
  type UnitValue,
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
        size="sm"
        style={{
          display: "inline-flex",
          alignItems: "baseline",
          gap: "var(--gap-related)",
          flexWrap: "wrap",
          fontWeight: 700,
          color: "var(--color-text-primary)",
        }}
      >
        {children}
      </Text>
    </Stack>
  );
}

const COMPACT_VALUE = {
  fontWeight: 700,
  color: "var(--color-text-primary)",
  whiteSpace: "nowrap",
} as const;

/** The game's vessel-total ΔV and burn time, and the craft's dry mass, side by side. */
export function TotalsSection({
  totalDv,
  totalBurnTime,
  dryMass,
  partCount,
  mode,
  compact = false,
}: {
  totalDv: UnitValue<"m/s"> | undefined;
  totalBurnTime: UnitValue<"s"> | null | undefined;
  dryMass: Reading<Value<"t">>;
  /** Parts on the craft, held ones marked; absent when the vessel's part list could not be read. */
  partCount: UnitValue<"count">;
  mode: DeltaVMode;
  /** Draws only the ΔV and the burn time, as label and value rows, for a tile too short for the boxed four. */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <Grid cols="auto 1fr" gap="label-value" rowGap="related" align="baseline">
        <ReadoutCaption style={{ whiteSpace: "nowrap" }}>
          ΔV {DELTA_V_MODE_SHORT[mode]}
        </ReadoutCaption>
        <Text size="sm" style={COMPACT_VALUE}>
          {totalDv !== undefined ? (
            <Unit value={totalDv} decimals={0} />
          ) : (
            NULL_DISPLAY
          )}
        </Text>
        <ReadoutCaption>Burn</ReadoutCaption>
        <Text size="sm" style={COMPACT_VALUE}>
          {totalBurnTime !== undefined ? (
            <Unit value={totalBurnTime} />
          ) : (
            NULL_DISPLAY
          )}
        </Text>
      </Grid>
    );
  }
  return (
    <Box
      surface="panel"
      bordered
      radius="regular"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "var(--gap-related) var(--gap-section)",
        padding: "var(--inset-surface)",
      }}
    >
      <TotalFigure label="Total ΔV">
        <span style={{ whiteSpace: "nowrap" }}>
          {totalDv !== undefined ? (
            <Unit value={totalDv} decimals={0} />
          ) : (
            NULL_DISPLAY
          )}
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
      <TotalFigure label="Dry mass">
        <span style={{ whiteSpace: "nowrap" }}>
          <Unit value={dryMass} />
        </span>
      </TotalFigure>
      <TotalFigure label="Parts">
        <span style={{ whiteSpace: "nowrap" }}>
          <Unit value={partCount} />
        </span>
      </TotalFigure>
    </Box>
  );
}
