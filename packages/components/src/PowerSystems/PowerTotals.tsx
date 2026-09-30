import { Text } from "@ksp-gonogo/ui-kit";
import { formatUnits, type NetTone } from "./flow";
import {
  CELL_LABEL,
  CELL_VALUE,
  MEASURED_CELL,
  NET_CELL_BY_TONE,
  NET_LABEL_COLOUR,
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
  net,
  netTone,
  totalProduced,
  totalConsumed,
  measuredTotalProduced,
  measuredDisagrees,
  storage,
}: Readonly<{
  net: number;
  netTone: NetTone;
  totalProduced: number;
  totalConsumed: number;
  measuredTotalProduced: number | undefined;
  measuredDisagrees: boolean;
  storage: { amount: number; maxAmount: number };
}>) {
  return (
    <div style={TOTALS}>
      <div style={{ ...TOTALS_CELL, ...NET_CELL_BY_TONE[netTone] }}>
        <span style={{ ...CELL_LABEL, color: NET_LABEL_COLOUR[netTone] }}>
          NET
        </span>
        <Text size="sm" style={CELL_VALUE}>
          {net >= 0 ? "+" : ""}
          {net.toFixed(2)}/s
        </Text>
      </div>
      <div style={TOTALS_CELL}>
        <span style={CELL_LABEL}>PROD</span>
        <Text tone="go" size="sm" style={CELL_VALUE}>
          {totalProduced > 0 ? "+" : ""}
          {totalProduced.toFixed(2)}
        </Text>
      </div>
      {measuredDisagrees && (
        <div
          style={{ ...TOTALS_CELL, ...MEASURED_CELL }}
          title={`parts.power.totalProductionEc reports ${measuredTotalProduced?.toFixed(2)}, disagreeing with the ${totalProduced.toFixed(2)} the itemized Producers rows sum to. PROD/NET always reflect the itemized rows; this is the separate raw measurement.`}
        >
          <span style={CELL_LABEL}>MEASURED</span>
          <Text size="sm" style={CELL_VALUE}>
            {measuredTotalProduced?.toFixed(2)}
          </Text>
        </div>
      )}
      <div style={TOTALS_CELL}>
        <span style={CELL_LABEL}>CONS</span>
        <Text tone="warn" size="sm" style={CELL_VALUE}>
          {totalConsumed.toFixed(2)}
        </Text>
      </div>
      {storage.maxAmount > 0 && (
        <div style={TOTALS_CELL}>
          <span style={CELL_LABEL}>STORED</span>
          <Text size="sm" style={STORED_VALUE}>
            {formatUnits(storage.amount)} / {formatUnits(storage.maxAmount)}
          </Text>
        </div>
      )}
    </div>
  );
}
