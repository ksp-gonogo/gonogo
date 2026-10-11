import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import {
  Box,
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

/** The game's vessel-total ΔV and burn time, and the craft's dry mass, side by side. */
export function TotalsSection({
  totalDv,
  totalBurnTime,
  dryMass,
  partCount,
  mode,
}: {
  totalDv: UnitValue<"m/s"> | undefined;
  totalBurnTime: UnitValue<"s"> | null | undefined;
  dryMass: Reading<Value<"t">>;
  /** Parts on the craft, held ones marked; absent when the vessel's part list could not be read. */
  partCount: UnitValue<"count">;
  mode: DeltaVMode;
}) {
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
