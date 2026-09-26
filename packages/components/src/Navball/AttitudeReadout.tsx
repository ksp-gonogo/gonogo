import type { TopicReading } from "@ksp-gonogo/sitrep-client";
import { readingOf, value } from "@ksp-gonogo/sitrep-sdk";
import {
  BigReadout,
  NULL_DISPLAY,
  ReadoutCaption,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties, ReactNode } from "react";

/**
 * Measured width the numeric readout needs for HDG, PCH and RLL on one line:
 * the widest readings (`359°`, `-90°`, `-180°`) plus two gaps at the
 * coarse-pointer type size. Each `1fr` column floors at its own content, so the
 * row fits at the sum, not at three times the widest cell. Below this the grid
 * overflows rather than clipping, so the overlap gate sees it.
 */
export const READOUT_TRIPLE_PX = 158;

/** Heading, pitch and roll as numbers, shown in place of the dial; a held attitude wears Unit's held mark on each. */
export function AttitudeReadout({
  heading,
  pitch,
  roll,
  across,
  reading,
}: {
  heading: number | null;
  pitch: number | null;
  roll: number | null;
  /** Whether the three cells fit on one line. */
  across: boolean;
  reading: TopicReading<unknown>;
}) {
  return (
    <>
      <div style={across ? READOUT_TRIPLE : READOUT_STACK}>
        {attitudeCells(heading, pitch, roll, reading).map((cell) =>
          across ? (
            <BigReadout key={cell.label} style={READOUT_CELL}>
              {cell.value}
              <ReadoutCaption>{cell.label}</ReadoutCaption>
            </BigReadout>
          ) : (
            <div key={cell.label} style={READOUT_PAIR}>
              <span style={READOUT_LABEL}>{cell.label}</span>
              <span style={READOUT_VALUE}>{cell.value}</span>
            </div>
          ),
        )}
      </div>
      <AttitudeAbsence reading={reading} />
    </>
  );
}

/** Says why there is no attitude to draw, under the null tokens that stand in for it. */
function AttitudeAbsence({ reading }: { reading: TopicReading<unknown> }) {
  if (reading.state === "pending") {
    return <ReadoutCaption>Waiting for attitude telemetry</ReadoutCaption>;
  }
  if (reading.state === "unowned") {
    return <ReadoutCaption>No attitude channel on this install</ReadoutCaption>;
  }
  if (reading.state === "absent") {
    return <ReadoutCaption>No attitude reported</ReadoutCaption>;
  }
  return null;
}

/**
 * The numeric readout's three cells. Pitch and roll carry an explicit `+`, since
 * an unsigned `45` reads as a magnitude; heading is a bearing and takes no sign.
 */
function attitudeCells(
  heading: number | null,
  pitch: number | null,
  roll: number | null,
  reading: TopicReading<unknown>,
): ReadonlyArray<{ label: string; value: ReactNode }> {
  // Each angle is drawn off the attitude's own reading, so a held attitude is marked, and dated, by Unit.
  const degrees = (v: number) => readingOf(reading, () => value("°", v));
  // One element, never a fragment: in the column-flex cell a bare sign would become its own flex item on its own line.
  const signed = (v: number | null): ReactNode => (
    <span>
      {v === null ? (
        NULL_DISPLAY
      ) : (
        <>
          {v >= 0 ? "+" : ""}
          <Unit value={degrees(v)} decimals={0} />
        </>
      )}
    </span>
  );
  return [
    {
      label: "HDG",
      value: (
        <span>
          {heading === null ? (
            NULL_DISPLAY
          ) : (
            <Unit value={degrees(heading)} decimals={0} />
          )}
        </span>
      ),
    },
    { label: "PCH", value: signed(pitch) },
    { label: "RLL", value: signed(roll) },
  ];
}

/**
 * HDG, PCH and RLL on one line, each reading over its caption. Never `auto-fit`
 * or a wrap, which would make the arity depend on digit count: the row is
 * always three across or, under {@link READOUT_TRIPLE_PX}, {@link READOUT_STACK}.
 */
const READOUT_TRIPLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: "var(--gap-related)",
};

/** One reading per line as label-beside-value pairs, 85px tall where stacked cells would need 136. */
const READOUT_STACK: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
};

/**
 * Makes a `BigReadout` one of three in a row. Its own font size follows the
 * viewport, not the tile, so it takes the stacked readout's size instead; its
 * zeroed `min-width` would let the `1fr` columns collapse; `nowrap` keeps a
 * sign on the same line as its number.
 */
const READOUT_CELL: CSSProperties = {
  fontSize: "var(--font-size-figure)",
  minWidth: "auto",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

const READOUT_PAIR: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "var(--gap-related)",
};

const READOUT_LABEL: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.12em",
  color: "var(--color-text-faint)",
};

const READOUT_VALUE: CSSProperties = {
  fontSize: "var(--font-size-figure)",
  fontWeight: 700,
  color: "var(--color-text-primary)",
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "0.04em",
};
