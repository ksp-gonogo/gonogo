import { Text } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { TONE_COLOR, type Tone } from "./tones";

const BAR_HEIGHT_PCT = [30, 50, 75, 100];

/** The four-bar signal chart. */
export function SignalBars({
  bars,
  tone,
  noSignal,
}: {
  bars: number | null;
  tone: Tone;
  noSignal?: boolean;
}) {
  return (
    <div
      role="img"
      /* "0 of 4" is itself a verdict, so a withheld glyph announces the badge's wording instead. */
      aria-label={signalBarsLabel(bars, noSignal)}
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: "var(--gap-signal-bars)",
        height: 24,
      }}
    >
      {[1, 2, 3, 4].map((i) => {
        const lit = bars !== null && i <= bars;
        const color = lit ? TONE_COLOR[tone] : "var(--color-border-subtle)";
        return (
          <span
            key={i}
            style={{
              width: 6,
              background: color,
              border: `1px solid ${color}`,
              // Off-scale on purpose: the 2px radius token rounds a 6px bar into a lozenge.
              borderRadius: 1,
              height: `${BAR_HEIGHT_PCT[i - 1]}%`,
            }}
          />
        );
      })}
    </div>
  );
}

/** The headline value beside the bars: percentage, LOS, or the control label. */
export function SignalHeadline({
  headline,
  lost,
}: {
  headline: ReactNode;
  lost: boolean;
}) {
  return (
    <Text
      size="lg"
      style={{
        letterSpacing: "0.04em",
        fontWeight: lost ? 700 : 400,
        color: lost ? "var(--color-nogo-text)" : undefined,
      }}
    >
      {headline}
    </Text>
  );
}

function signalBarsLabel(bars: number | null, noSignal: boolean | undefined) {
  if (noSignal) return "No signal";
  if (bars === null) return "Signal unknown";
  return `Signal ${bars} of 4`;
}
