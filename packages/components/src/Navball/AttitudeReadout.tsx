import {
  observedAt,
  type TopicReading,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
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

/** Heading, pitch and roll as numbers, shown in place of the dial, then why the dial is not there. */
export function AttitudeReadout({
  heading,
  pitch,
  roll,
  across,
  dialSuppressed,
  reading,
}: {
  heading: number | null;
  pitch: number | null;
  roll: number | null;
  /** Whether the three cells fit on one line. */
  across: boolean;
  /** A dial was wanted and the attitude's currency withheld it. */
  dialSuppressed: boolean;
  reading: TopicReading<unknown>;
}) {
  return (
    <>
      <div style={across ? READOUT_TRIPLE : READOUT_STACK}>
        {attitudeCells(heading, pitch, roll).map((cell) =>
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
      <AttitudeCurrency dialSuppressed={dialSuppressed} reading={reading} />
    </>
  );
}

/**
 * Says why the dial is not there, under the numbers that replaced it.
 * `dialSuppressed` separates a non-current attitude from a tile merely too
 * small for a dial, which needs no explanation.
 */
function AttitudeCurrency({
  reading,
  dialSuppressed,
}: {
  reading: TopicReading<unknown>;
  dialSuppressed: boolean;
}) {
  if (reading.state === "observed") return null;
  if (reading.state === "pending") {
    return <ReadoutCaption>Waiting for attitude telemetry</ReadoutCaption>;
  }
  if (reading.state === "unowned") {
    return <ReadoutCaption>No attitude channel on this install</ReadoutCaption>;
  }
  if (reading.state === "absent") {
    return <ReadoutCaption>No attitude reported</ReadoutCaption>;
  }
  return (
    <StaleCaption
      label={dialSuppressed ? "attitude at last contact" : "at last contact"}
      reading={reading}
    />
  );
}

/** The dated half of the caption, its own component so the per-frame `useViewUt` subscription exists only while a caption is on screen. */
function StaleCaption({
  label,
  reading,
}: {
  label: string;
  reading: TopicReading<unknown>;
}) {
  const viewUt = useViewUt();
  // Clamped: an out-of-order sample can sit just ahead of the frame.
  const observedUt = observedAt(reading);
  const ageSec =
    viewUt && observedUt
      ? Math.max(0, viewUt.minus(observedUt).magnitude)
      : undefined;
  return (
    <ReadoutCaption>
      <span role="status">{label}</span>
      {ageSec !== undefined && (
        <>
          , <Unit value={value("s", ageSec)} /> ago
        </>
      )}
    </ReadoutCaption>
  );
}

/**
 * The numeric readout's three cells. Pitch and roll carry an explicit `+`, since
 * an unsigned `45` reads as a magnitude; heading is a bearing and takes no sign.
 */
function attitudeCells(
  heading: number | null,
  pitch: number | null,
  roll: number | null,
): ReadonlyArray<{ label: string; value: ReactNode }> {
  // One element, never a fragment: in the column-flex cell a bare sign would become its own flex item on its own line.
  const signed = (v: number | null): ReactNode => (
    <span>
      {v === null ? (
        NULL_DISPLAY
      ) : (
        <>
          {v >= 0 ? "+" : ""}
          <Unit value={value("°", v)} decimals={0} />
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
            <Unit value={value("°", heading)} decimals={0} />
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
