import {
  Cluster,
  formatDuration,
  MissionDate,
  NULL_DISPLAY,
  Row,
  Stack,
  Text,
  Truncate,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import {
  type BurnAxis,
  type BurnInstantKind,
  type BurnInstantRow,
  burnAxis,
  burnDurationSeconds,
  burnInstantRows,
} from "./burnWindow";

// ---------------------------------------------------------------------------
// The three instants of one burn, laid out on the vessel-tracker deadline-row
// pattern rather than a re-derivation of it. That layout took four commits to
// stay readable at the smallest sizes, and the decisions carried over here are
// the ones those commits arrived at:
//
//   - each row states what distinguishes it from the other two, because three
//     rows each showing only a duration are indistinguishable
//   - the long explanatory text is a TOOLTIP; on the row it truncates first and
//     truncating it is what destroyed the distinction it existed to draw
//   - the pair most likely to be conflated is separated by SHAPE, not hue, so
//     it survives greyscale and colour-vision deficiency
//   - the numeric extra (here the duration) sits beside the value, never folded
//     into the basis line, which pushed both off the end of the row
// ---------------------------------------------------------------------------

/**
 * One hue per instant, off the CATEGORICAL ramp rather than the status palette:
 * hue answers "which of the three is this", where a status colour would answer
 * "how bad is it", which is not a question a burn window has any business
 * answering.
 */
const KIND_COLOUR: Record<BurnInstantKind, string> = {
  ignition: "var(--color-data-1)",
  reference: "var(--color-data-3)",
  cutoff: "var(--color-data-5)",
};

/**
 * Ignition and cutoff are the pair a reader is most likely to conflate: both
 * are engine events, only one of them is the one to act on now, and on the axis
 * they are the two endpoint marks. So they are separated by FORM as well as
 * hue, because a hue difference does not survive a greyscale screenshot or a
 * glance. The reference sits between them and is the odd one out already.
 */
const KIND_MARK: Record<BurnInstantKind, "round" | "diamond"> = {
  ignition: "round",
  reference: "round",
  cutoff: "diamond",
};

const CAPTION: CSSProperties = {
  fontSize: "var(--font-size-2xs)",
  color: "var(--color-text-muted)",
  letterSpacing: "0.04em",
};

const KIND_CHIP: CSSProperties = {
  fontSize: "var(--font-size-2xs)",
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

/**
 * Half the widest mark's on-screen extent.
 *
 * The cutoff mark is a square turned 45 degrees, so its bounding box is sqrt(2)
 * times its width and it reaches about 21% further than the round marks. Sizing
 * the track inset for the widest mark costs the circles a fraction of a pixel
 * and cannot come back at a smaller scale, which halving the plain width did:
 * the cutoff mark sat centred on the right-hand end with half its body outside
 * and read on screen as a left-pointing triangle.
 */
const MARK_HALF_EXTENT = "calc(var(--space-6) * 0.7072)";

/**
 * Where a mark's CENTRE sits, as a CSS length, inset from both ends by
 * {@link MARK_HALF_EXTENT}.
 *
 * Padding on the track cannot do this, which is the trap that made the first fix
 * a no-op: an absolutely-positioned child's containing block is its positioned
 * ancestor's PADDING BOX, so a percentage resolves against a width that already
 * includes that padding and `left: 100%` lands at the same place either way. The
 * inset has to be in the position arithmetic, not around it.
 */
function trackPosition(fraction: number): string {
  return `calc(${MARK_HALF_EXTENT} + ${fraction} * (100% - 2 * ${MARK_HALF_EXTENT}))`;
}

function relativeToNow(atUt: number, nowUt: number): string {
  const delta = atUt - nowUt;
  if (delta < 0) return `${formatDuration(-delta)} ago`;
  return `in ${formatDuration(delta)}`;
}

/** The kind's hue, repeated from the axis mark so a row and its mark read as one thing. */
function KindSwatch({ kind }: { kind: BurnInstantKind }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flex: "0 0 auto",
        width: 3,
        alignSelf: "stretch",
        borderRadius: "var(--radius-xs)",
        background: KIND_COLOUR[kind],
      }}
    />
  );
}

function InstantRow({ row, nowUt }: { row: BurnInstantRow; nowUt: number }) {
  return (
    <Row
      as="li"
      data-burn-instant-row=""
      title={row.question}
      style={{ alignItems: "stretch", gap: "var(--space-8)" }}
    >
      <Cluster
        justify="start"
        style={{ gap: "var(--space-6)", minWidth: 0, alignItems: "stretch" }}
      >
        <KindSwatch kind={row.kind} />
        <Stack gap="xs" style={{ minWidth: 0 }}>
          <Cluster align="baseline" style={{ gap: "var(--space-6)" }}>
            <span style={{ ...KIND_CHIP, color: KIND_COLOUR[row.kind] }}>
              {row.label}
            </span>
          </Cluster>
          {/* The basis alone. The long form is the tooltip: on the row it is
              the first thing to truncate, and truncating it is what made two
              rows read alike in the widget this layout came from. */}
          <Truncate style={CAPTION} title={row.detail ?? row.question}>
            {row.basis}
          </Truncate>
        </Stack>
      </Cluster>
      <Stack gap="xs" style={{ alignItems: "flex-end", flex: "0 0 auto" }}>
        <Text tone="default" size="sm" style={{ whiteSpace: "nowrap" }}>
          {row.atUt == null ? NULL_DISPLAY : relativeToNow(row.atUt, nowUt)}
        </Text>
        {row.atUt != null && (
          <span style={{ ...CAPTION, whiteSpace: "nowrap" }}>
            <MissionDate value={row.atUt} />
          </span>
        )}
      </Stack>
    </Row>
  );
}

/** Axis ordering, spoken, so the picture is not sighted-operators-only. */
function axisDescription(
  axis: BurnAxis,
  rows: readonly BurnInstantRow[],
): string {
  const named = [...axis.marks]
    .sort((a, b) => a.atUt - b.atUt)
    .map((mark) => rows.find((r) => r.kind === mark.kind)?.label ?? mark.kind);
  return `Burn order: ${named.join(", then ")}`;
}

function BurnAxisBar({
  axis,
  rows,
}: {
  axis: BurnAxis;
  rows: readonly BurnInstantRow[];
}) {
  return (
    <div
      role="img"
      aria-label={axisDescription(axis, rows)}
      style={{
        position: "relative",
        height: "var(--space-12)",
        marginInlineStart: "var(--space-8)",
        // No padding here on purpose: see MARK_HALF_EXTENT for why padding
        // cannot do this job.
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          insetInline: MARK_HALF_EXTENT,
          top: "50%",
          height: 1,
          background: "var(--color-border-subtle)",
        }}
      />
      {/* Omitted, never clamped, when the clock is outside the burn: a marker
          pinned to ignition while the burn is still minutes away would be a lie
          about the one thing being read off this axis. */}
      {axis.nowFraction >= 0 && axis.nowFraction <= 1 && (
        <span
          aria-hidden="true"
          title="now"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            width: 1,
            background: "var(--color-text-muted)",
            left: trackPosition(axis.nowFraction),
          }}
        />
      )}
      {axis.marks.map((mark) => (
        <span
          key={mark.kind}
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "50%",
            width: "var(--space-6)",
            height: "var(--space-6)",
            background: KIND_COLOUR[mark.kind],
            // --radius-circle, never a hand-computed 50%: the token exists so a
            // circle stays a circle if the mark size ever changes.
            borderRadius:
              KIND_MARK[mark.kind] === "round" ? "var(--radius-circle)" : 0,
            // Centred on its own position, so the inset arithmetic below is
            // about the TRACK and never about which shape is being drawn.
            transform:
              KIND_MARK[mark.kind] === "diamond"
                ? "translate(-50%, -50%) rotate(45deg)"
                : "translate(-50%, -50%)",
            left: trackPosition(mark.fraction),
          }}
        />
      ))}
    </div>
  );
}

/**
 * One burn's window: three rows, always all three, plus a shared axis when
 * there is an ordering to show. The axis is deliberately absent for an
 * impulsive plan, where a single mark would be decoration dressed as
 * information.
 */
export function BurnWindowRows({
  burn,
  nowUt,
}: {
  burn: { ut: number; ignitionUt?: number | null; cutoffUt?: number | null };
  nowUt: number;
}) {
  const rows = burnInstantRows(burn);
  const axis = burnAxis(rows, nowUt);
  const duration = burnDurationSeconds(burn);

  return (
    <Stack gap="xs">
      <Cluster
        justify="between"
        align="baseline"
        style={{ gap: "var(--space-6)" }}
      >
        <span style={{ ...KIND_CHIP, color: "var(--color-text-muted)" }}>
          Burn window
        </span>
        {/* Beside the value, never folded into a basis line: it is a separate
            fact from how the instants were derived, and sharing that line
            pushed both off the end of the row. */}
        <span style={CAPTION}>
          {duration == null
            ? NULL_DISPLAY
            : `lasts ${formatDuration(duration)}`}
        </span>
      </Cluster>
      <Stack
        as="ul"
        gap="xs"
        style={{ listStyle: "none", margin: 0, padding: 0 }}
      >
        {rows.map((row) => (
          <InstantRow key={row.kind} row={row} nowUt={nowUt} />
        ))}
      </Stack>
      {axis && <BurnAxisBar axis={axis} rows={rows} />}
    </Stack>
  );
}
