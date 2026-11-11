import { value } from "@ksp-gonogo/sitrep-sdk";
import type { PanelBadge } from "@ksp-gonogo/ui-kit";
import { Text, Unit } from "@ksp-gonogo/ui-kit";
import type { ChargeTrend, ChargeTrendDirection } from "./chargeTrend";
import { CELL_LABEL, TREND_BOX, TREND_BOX_COMPACT } from "./styles";

const WORD: Record<ChargeTrendDirection, string> = {
  charging: "Charging",
  draining: "Draining",
  steady: "Steady",
};

const TONE = {
  charging: "go",
  draining: "warn",
  steady: "neutral",
} as const;

/** The panel header badge for the charge trend, none while there is no trend. */
export function chargeTrendBadges(
  trend: ChargeTrend | undefined,
): readonly PanelBadge[] | undefined {
  if (!trend) return undefined;
  return [
    {
      id: "charge-trend",
      label: WORD[trend.direction],
      tone: TONE[trend.direction],
      title: "Whether the stored electric charge is rising or falling",
    },
  ];
}

/**
 * What the vessel's stored electric charge is doing, in the tone of the header
 * badge: the time until it is empty while it falls, the time until it is full
 * while it rises, "holding" while it is level, and "full" or "empty" once the
 * store is at that limit. Draws nothing while there is no trend. Useful for
 * telling the operator how long the batteries last or take to fill at the
 * present rate. Used by the Power Systems widget.
 */
export function ChargeTrendBox({
  trend,
  compact,
}: Readonly<{
  trend: ChargeTrend | undefined;
  compact?: boolean;
}>) {
  if (!trend) return null;
  return (
    <div style={compact ? TREND_BOX_COMPACT : TREND_BOX}>
      {!compact && <span style={CELL_LABEL}>Charge</span>}
      <Text size="sm" tone={TONE[trend.direction]}>
        <TrendWords trend={trend} />
      </Text>
    </div>
  );
}

function TrendWords({ trend }: Readonly<{ trend: ChargeTrend }>) {
  if (trend.secondsToEmpty !== undefined) {
    return (
      <>
        empty in <Unit value={value("s", trend.secondsToEmpty)} />
      </>
    );
  }
  if (trend.secondsToFull !== undefined) {
    return (
      <>
        full in <Unit value={value("s", trend.secondsToFull)} />
      </>
    );
  }
  if (trend.direction === "steady") return <>holding</>;
  return <>{trend.direction === "charging" ? "full" : "empty"}</>;
}
