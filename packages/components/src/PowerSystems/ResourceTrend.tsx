import { value } from "@ksp-gonogo/sitrep-sdk";
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
  warn: "var(--color-status-warning-bg)",
  go: "var(--color-status-go-fg)",
  neutral: "var(--color-text-primary)",
};

/** The stored level over the trend window, anchored to capacity so a half-full battery reads as half-full. */
export function ResourceTrend({
  resource,
  windowSec,
  values,
  domain,
  netTone,
}: Readonly<{
  resource: string;
  windowSec: number;
  values: number[];
  domain: [number, number] | undefined;
  netTone: NetTone;
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
        </span>
      </span>
      <div style={SPARKLINE_SLOT}>
        <Sparkline
          values={values}
          width={240}
          height={36}
          color={TREND_COLOUR[netTone]}
          yDomain={domain}
          ariaLabel={`${splitCamel(resource)} level trend`}
        />
      </div>
    </div>
  );
}
