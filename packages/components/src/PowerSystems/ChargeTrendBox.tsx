import { value } from "@ksp-gonogo/sitrep-sdk";
import type { PanelBadge } from "@ksp-gonogo/ui-kit";
import {
  HeldFigure,
  MissionDate,
  Text,
  Unit,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
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

/** What the modelled figures assume, said once where a figure carries the modelled mark. */
export const MODELLED_CAPTION =
  "modelled from the last report received, holding its net rate";

/** A modelled time to empty is a claim about minutes, so it is rounded to the minute from two minutes up. */
function roughSeconds(seconds: number): number {
  return seconds >= 120 ? Math.round(seconds / 60) * 60 : Math.round(seconds);
}

/** The words on the header badge for a charge trend: the time to empty while draining, "empty" at zero, "likely empty" once a model has crossed it. */
function badgeLabel(trend: ChargeTrend): string {
  if (trend.direction !== "draining") return WORD[trend.direction];
  if (trend.secondsToEmpty !== undefined) {
    return trend.modelled
      ? `Empty in ~${writeQuantity(value("s", roughSeconds(trend.secondsToEmpty)))}`
      : `Empty in ${writeQuantity(value("s", Math.round(trend.secondsToEmpty)))}`;
  }
  if (trend.atLimit) return trend.modelled ? "Likely empty" : "Empty";
  return WORD.draining;
}

/**
 * The panel header badge for the charge trend, none while there is no trend.
 * A draining store reads as the time to empty, red once it is empty; a trend
 * carried forward from a held report is blue, since it is modelled.
 */
export function chargeTrendBadges(
  trend: ChargeTrend | undefined,
): readonly PanelBadge[] | undefined {
  if (!trend) return undefined;
  const empty = trend.direction === "draining" && trend.atLimit;
  const tone =
    trend.modelled && !empty ? "info" : empty ? "nogo" : TONE[trend.direction];
  return [
    {
      id: "charge-trend",
      label: badgeLabel(trend),
      tone,
      title: trend.modelled
        ? `Stored electric charge, ${MODELLED_CAPTION}`
        : "Whether the stored electric charge is rising or falling",
    },
  ];
}

/**
 * What the vessel's stored electric charge is doing, in the tone of the header
 * badge: the time until it is empty while it falls, the time until it is full
 * while it rises, "holding" while it is level, and "full" or "empty" once the
 * store is at that limit. A trend carried forward from a held report is drawn
 * with the modelled mark. Draws nothing while there is no trend. Useful for
 * telling the operator how long the batteries last or take to fill at the
 * present rate. Used by the Power Systems widget at its smallest size.
 */
export function ChargeTrendBox({
  trend,
  compact,
}: Readonly<{
  trend: ChargeTrend | undefined;
  compact?: boolean;
}>) {
  if (!trend) return null;
  const words = (
    <Text size="sm" tone={trend.modelled ? "info" : TONE[trend.direction]}>
      <TrendWords trend={trend} />
    </Text>
  );
  return (
    <div style={compact ? TREND_BOX_COMPACT : TREND_BOX}>
      {!compact && <span style={CELL_LABEL}>Charge</span>}
      {trend.modelled ? (
        <HeldFigure kind="modelled" caption={MODELLED_CAPTION}>
          {words}
        </HeldFigure>
      ) : (
        words
      )}
    </div>
  );
}

function TrendWords({ trend }: Readonly<{ trend: ChargeTrend }>) {
  const lead = trend.modelled ? "~" : "";
  if (trend.secondsToEmpty !== undefined) {
    return (
      <>
        empty in {lead}
        <Unit
          value={value(
            "s",
            trend.modelled
              ? roughSeconds(trend.secondsToEmpty)
              : trend.secondsToEmpty,
          )}
        />
      </>
    );
  }
  if (trend.emptySinceUt !== undefined) {
    return (
      <>
        likely empty since <MissionDate value={trend.emptySinceUt} />
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
