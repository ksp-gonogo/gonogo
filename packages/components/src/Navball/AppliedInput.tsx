import type { TopicReading } from "@ksp-gonogo/sitrep-client";
import { readingOf, type Value } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY, Unit } from "@ksp-gonogo/ui-kit";
import type { CSSProperties, ReactNode } from "react";

/** The pitch and roll axis input the craft is applying, beside the attitude it produces. */
export function AppliedInput({
  pitch,
  roll,
  reading,
}: {
  pitch: Value<"1"> | null | undefined;
  roll: Value<"1"> | null | undefined;
  reading: TopicReading<unknown>;
}) {
  // A craft that reports neither axis has no input to show, so the row is left out rather than drawn as two dashes.
  const shown = (axis: Value<"1"> | null | undefined) =>
    axis != null && axis.isFinite() ? axis : null;
  const pitchShown = shown(pitch);
  const rollShown = shown(roll);
  if (pitchShown === null && rollShown === null) return null;
  return (
    <div style={ROW}>
      <span style={LABEL}>INPUT</span>
      <Axis label="PITCH" axis={pitchShown} reading={reading} />
      <Axis label="ROLL" axis={rollShown} reading={reading} />
    </div>
  );
}

function Axis({
  label,
  axis,
  reading,
}: {
  label: string;
  axis: Value<"1"> | null;
  reading: TopicReading<unknown>;
}) {
  const cell: ReactNode =
    axis === null ? (
      NULL_DISPLAY
    ) : (
      <>
        {axis.isNegative() ? "" : "+"}
        <Unit value={readingOf(reading, () => axis.in("%"))} decimals={0} />
      </>
    );
  return (
    <span style={PAIR}>
      <span style={LABEL}>{label}</span>
      <span style={VALUE}>{cell}</span>
    </span>
  );
}

const ROW: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "var(--gap-related)",
  flexWrap: "wrap",
};

const PAIR: CSSProperties = {
  display: "inline-flex",
  alignItems: "baseline",
  gap: "var(--gap-related)",
};

const LABEL: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.12em",
  color: "var(--color-text-faint)",
};

const VALUE: CSSProperties = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-primary)",
  fontVariantNumeric: "tabular-nums",
};
