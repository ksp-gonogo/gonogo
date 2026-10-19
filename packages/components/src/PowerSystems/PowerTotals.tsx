import { NULL_DISPLAY, Text, Tooltip, Unit } from "@ksp-gonogo/ui-kit";
import type { ComponentProps } from "react";
import { formatUnits, type NetTone } from "./flow";
import { UNKNOWN_DRAW_TEXT } from "./OtherDrawRow";
import {
  CELL_LABEL,
  CELL_VALUE,
  MEASURED_CELL,
  NET_CELL_BY_TONE,
  NET_LABEL_COLOUR,
  NET_VALUE,
  NO_BREAK,
  STORED_VALUE,
  TOTALS,
  TOTALS_CELL,
} from "./styles";

/**
 * NET, PROD and CONS for the focused resource, the raw measurement where it
 * disagrees, and storage. The held mark for the parts read behind these
 * figures is a panel badge, not a cell here: a fifth cell pushed the grid to
 * a third row and left the Producers/Consumers list no room at the widget's
 * own minimum size.
 */
export function PowerTotals({
  netFigure,
  drawUnknown,
  flowMeasured,
  net,
  netTone,
  unratedCount,
  totalProduced,
  totalConsumed,
  measuredTotalProduced,
  measuredDisagrees,
  storage,
}: Readonly<{
  /** The net rate as the figure the cell draws, null while the net is unknown rather than zero. */
  netFigure: ComponentProps<typeof Unit>["value"] | null;
  /** The stored charge is not moving, so the net and the total draw cannot be read: both show as unknown. */
  drawUnknown: boolean;
  /** Whether any part reports a measured flow; without one PROD is unknown too. */
  flowMeasured: boolean;
  net: number;
  netTone: NetTone;
  /** Parts running a process with no published rate: their draw or yield is missing from NET. */
  unratedCount: number;
  totalProduced: number;
  totalConsumed: number;
  measuredTotalProduced: number | undefined;
  measuredDisagrees: boolean;
  /** Null when a store aboard could not be read. */
  storage: { amount: number; maxAmount: number } | null;
}>) {
  return (
    <div style={TOTALS}>
      <div style={{ ...TOTALS_CELL, ...NET_CELL_BY_TONE[netTone] }}>
        <span style={{ ...CELL_LABEL, color: NET_LABEL_COLOUR[netTone] }}>
          NET
        </span>
        <Text size="sm" style={NET_VALUE}>
          {netFigure !== null ? (
            <>
              {net >= 0 ? "+" : ""}
              <Unit value={netFigure} decimals={2} />
            </>
          ) : drawUnknown ? (
            <UnknownFigure label="Net rate unknown" />
          ) : (
            NULL_DISPLAY
          )}
        </Text>
        {unratedCount > 0 && (
          <Tooltip
            text={`${unratedCount} running ${unratedCount === 1 ? "process has" : "processes have"} no published rate, so NET leaves ${unratedCount === 1 ? "its" : "their"} draw out`}
            focusable
          >
            <span style={CELL_LABEL}>+{unratedCount} unrated</span>
          </Tooltip>
        )}
      </div>
      <div style={TOTALS_CELL}>
        <span style={CELL_LABEL}>PROD</span>
        <Text tone="go" size="sm" style={CELL_VALUE}>
          {flowMeasured ? (
            <>
              {totalProduced > 0 ? "+" : ""}
              {totalProduced.toFixed(2)}
            </>
          ) : (
            NULL_DISPLAY
          )}
        </Text>
      </div>
      {measuredDisagrees && (
        <Tooltip
          text={`parts.power.totalProductionEc reports ${measuredTotalProduced?.toFixed(2)}, disagreeing with the ${totalProduced.toFixed(2)} the itemized Producers rows sum to. PROD/NET always reflect the itemized rows; this is the separate raw measurement.`}
          focusable
        >
          <div style={{ ...TOTALS_CELL, ...MEASURED_CELL }}>
            <span style={CELL_LABEL}>MEASURED</span>
            <Text size="sm" style={CELL_VALUE}>
              {measuredTotalProduced?.toFixed(2)}
            </Text>
          </div>
        </Tooltip>
      )}
      <div style={TOTALS_CELL}>
        <span style={CELL_LABEL}>CONS</span>
        <Text tone="warn" size="sm" style={CELL_VALUE}>
          {drawUnknown ? (
            <UnknownFigure label="Total draw unknown" />
          ) : netFigure !== null ? (
            totalConsumed.toFixed(2)
          ) : (
            NULL_DISPLAY
          )}
        </Text>
      </div>
      {storage && storage.maxAmount > 0 && (
        <div style={TOTALS_CELL}>
          <span style={CELL_LABEL}>STORED</span>
          <Text size="sm" style={STORED_VALUE}>
            <span style={NO_BREAK}>{formatUnits(storage.amount)}</span>{" "}
            <span style={NO_BREAK}>/ {formatUnits(storage.maxAmount)}</span>
          </Text>
        </div>
      )}
    </div>
  );
}

function UnknownFigure({ label }: Readonly<{ label: string }>) {
  return (
    <Tooltip text={UNKNOWN_DRAW_TEXT} focusable>
      <span role="img" aria-label={label}>
        {NULL_DISPLAY}
      </span>
    </Tooltip>
  );
}
