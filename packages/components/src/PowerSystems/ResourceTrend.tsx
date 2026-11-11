import { type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { Sparkline } from "@ksp-gonogo/ui";
import { speakQuantity, Unit } from "@ksp-gonogo/ui-kit";
import { type NetTone, splitCamel } from "./flow";
import {
  SPARKLINE_LABEL,
  SPARKLINE_ROW,
  SPARKLINE_SLOT,
  SPARKLINE_SUB,
} from "./styles";

const TREND_COLOUR: Record<NetTone, string> = {
  warn: "var(--color-warn-mark)",
  go: "var(--color-go-text)",
  neutral: "var(--color-text-primary)",
};

/** The stored level over the trend window, anchored to capacity so a half-full battery reads as half-full. */
export function ResourceTrend({
  resource,
  windowSec,
  values,
  domain,
  netTone,
  projection,
}: Readonly<{
  resource: string;
  windowSec: number;
  values: number[];
  domain: [number, number] | undefined;
  netTone: NetTone;
  /** Where a held report carries the level to now, drawn as a dashed line past the last report. */
  projection?: { stored: number; elapsed: Value<"s"> };
}>) {
  return (
    <div
      style={SPARKLINE_ROW}
      role="img"
      aria-label={`${splitCamel(resource)} level over the last ${speakQuantity(
        value("s", windowSec),
      )}`}
    >
      <span style={SPARKLINE_LABEL}>
        Trend
        <span style={SPARKLINE_SUB}>
          · <Unit value={value("s", windowSec)} />
          {projection && " · modelled to SCET"}
        </span>
      </span>
      <div style={SPARKLINE_SLOT}>
        {projection && domain ? (
          <ProjectedSparkline
            values={values}
            domain={domain}
            projection={projection}
            windowSec={windowSec}
            color={TREND_COLOUR[netTone]}
          />
        ) : (
          <Sparkline
            values={values}
            width={240}
            height={36}
            color={TREND_COLOUR[netTone]}
            yDomain={domain}
            aria-label={`${splitCamel(resource)} level trend`}
          />
        )}
      </div>
    </div>
  );
}

const PROJECTED_WIDTH = 240;
const PROJECTED_HEIGHT = 36;

/**
 * The level up to the last report, then a dashed line to where the model has
 * it now, with the cut marked between. The model's share of the width follows
 * the time it covers, but never takes more than half.
 */
function ProjectedSparkline({
  values,
  domain,
  projection,
  windowSec,
  color,
}: Readonly<{
  values: number[];
  domain: [number, number];
  projection: { stored: number; elapsed: Value<"s"> };
  windowSec: number;
  color: string;
}>) {
  const [lo, hi] = domain;
  const y = (v: number) =>
    PROJECTED_HEIGHT - 2 - ((v - lo) / (hi - lo || 1)) * (PROJECTED_HEIGHT - 4);
  const cutShare = Math.min(
    0.5,
    Number(
      projection.elapsed.per(projection.elapsed.plus(value("s", windowSec))),
    ),
  );
  const cutX = PROJECTED_WIDTH * (1 - cutShare);
  const observed = values
    .map(
      (v, i) =>
        `${i === 0 ? "M" : "L"}${((i / Math.max(1, values.length - 1)) * cutX).toFixed(1)},${y(v).toFixed(1)}`,
    )
    .join(" ");
  const last = values[values.length - 1];
  return (
    <svg
      width={PROJECTED_WIDTH}
      height={PROJECTED_HEIGHT}
      role="img"
      aria-label="Electric charge level, modelled from the last report"
      style={{ display: "block" }}
    >
      <path d={observed} stroke={color} strokeWidth={1.5} fill="none" />
      <line
        x1={cutX}
        x2={cutX}
        y1={0}
        y2={PROJECTED_HEIGHT}
        stroke="var(--color-warn-mark)"
        strokeDasharray="2 2"
      />
      <line
        x1={cutX}
        y1={y(last)}
        x2={PROJECTED_WIDTH}
        y2={y(projection.stored)}
        stroke="var(--color-info-text)"
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      <polygon
        points={`${PROJECTED_WIDTH - 5},${y(projection.stored) - 3} ${PROJECTED_WIDTH},${y(projection.stored) + 3} ${PROJECTED_WIDTH - 10},${y(projection.stored) + 3}`}
        fill="var(--color-info-text)"
        transform={`rotate(180 ${PROJECTED_WIDTH - 5} ${y(projection.stored)})`}
      />
    </svg>
  );
}
