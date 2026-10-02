import { type CarriedCurrency, datedFrom, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Cluster,
  MissionDate,
  NULL_DISPLAY,
  Row,
  Stack,
  Text,
  Tooltip,
  Truncate,
  Unit,
  writeQuantity,
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

/** Categorical hues, not status colours: hue says which instant this is, not how bad it is. */
const KIND_COLOUR: Record<BurnInstantKind, string> = {
  ignition: "var(--color-data-1)",
  reference: "var(--color-data-3)",
  cutoff: "var(--color-data-5)",
};

/** Ignition and cutoff, the pair most easily conflated, differ by shape as well as hue so they survive greyscale. */
const KIND_MARK: Record<BurnInstantKind, "round" | "diamond"> = {
  ignition: "round",
  reference: "round",
  cutoff: "diamond",
};

const CAPTION: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  color: "var(--color-text-muted)",
  letterSpacing: "0.04em",
};

const KIND_CHIP: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

/** Half the widest mark's extent: the diamond is a 45-degree square, sqrt(2) times its width across. */
const MARK_HALF_EXTENT = "calc(var(--size-burn-mark) * 0.7072)";

/**
 * A mark's centre as a CSS length, inset from both ends by
 * {@link MARK_HALF_EXTENT}. Padding cannot do this: an absolute child's
 * percentages resolve against its ancestor's padding box.
 */
function trackPosition(fraction: number): string {
  return `calc(${MARK_HALF_EXTENT} + ${fraction} * (100% - 2 * ${MARK_HALF_EXTENT}))`;
}

/** Game seconds, on the ladder where a KSP day is 6 hours; a string so "ago"/"in" stay attached to the number. */
function relativeToNow(atUt: number, nowUt: number): string {
  const delta = atUt - nowUt;
  if (delta < 0) return `${writeQuantity(value("s", -delta))} ago`;
  return `in ${writeQuantity(value("s", delta))}`;
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
        borderRadius: "var(--radius-regular)",
        background: KIND_COLOUR[kind],
      }}
    />
  );
}

function InstantRow({
  row,
  nowUt,
  from,
}: {
  row: BurnInstantRow;
  nowUt: number;
  from?: readonly CarriedCurrency[];
}) {
  return (
    <Tooltip text={row.question} announce={false}>
      <Row
        as="li"
        data-burn-instant-row=""
        style={{ alignItems: "stretch", gap: "var(--gap-related)" }}
      >
        <Cluster
          justify="start"
          style={{
            gap: "var(--gap-related)",
            minWidth: 0,
            alignItems: "stretch",
          }}
        >
          <KindSwatch kind={row.kind} />
          <Stack style={{ minWidth: 0 }}>
            <Cluster align="baseline" style={{ gap: "var(--gap-related)" }}>
              <span style={{ ...KIND_CHIP, color: KIND_COLOUR[row.kind] }}>
                {row.label}
              </span>
            </Cluster>
            {/* Only the absent case gets a subtitle: it says why there is no time. */}
            {row.atUt == null && (
              <Tooltip text={row.detail ?? row.question} focusable>
                <Truncate style={CAPTION}>{row.basis}</Truncate>
              </Tooltip>
            )}
          </Stack>
        </Cluster>
        <Stack style={{ alignItems: "flex-end", flex: "0 0 auto" }}>
          <Text size="sm" style={{ whiteSpace: "nowrap" }}>
            {row.atUt == null ? NULL_DISPLAY : relativeToNow(row.atUt, nowUt)}
          </Text>
          {row.atUt != null && (
            <span style={{ ...CAPTION, whiteSpace: "nowrap" }}>
              <MissionDate
                value={
                  from === undefined
                    ? row.atUt
                    : datedFrom(from, value("ut", row.atUt))
                }
              />
            </span>
          )}
        </Stack>
      </Row>
    </Tooltip>
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
        height: "var(--size-burn-axis)",
        marginInlineStart: "var(--indent-burn-axis)",
        // No padding: see trackPosition.
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
      {/* Omitted, never clamped, when now is outside the burn. */}
      {axis.nowFraction >= 0 && axis.nowFraction <= 1 && (
        <Tooltip text="now" announce={false}>
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              width: 1,
              background: "var(--color-text-muted)",
              left: trackPosition(axis.nowFraction),
            }}
          />
        </Tooltip>
      )}
      {axis.marks.map((mark) => (
        <span
          key={mark.kind}
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "50%",
            width: "var(--size-burn-mark)",
            height: "var(--size-burn-mark)",
            background: KIND_COLOUR[mark.kind],
            borderRadius:
              KIND_MARK[mark.kind] === "round" ? "var(--radius-circle)" : 0,
            // Centred on its own position, so the inset arithmetic is about the track, never the shape.
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

/** One burn's window: always three rows, plus an axis when there is an ordering to show (never for an impulsive plan). */
export function BurnWindowRows({
  burn,
  nowUt,
  from,
}: {
  burn: { ut: number; ignitionUt?: number | null; cutoffUt?: number | null };
  nowUt: number;
  from?: readonly CarriedCurrency[];
}) {
  const rows = burnInstantRows(burn);
  const axis = burnAxis(rows, nowUt);
  const duration = burnDurationSeconds(burn);

  return (
    <Stack>
      <Cluster
        justify="end"
        align="baseline"
        style={{ gap: "var(--gap-related)" }}
      >
        {/* A bare null, not "lasts" beside Unit's null token, which would claim a length it declines to state. */}
        <span style={CAPTION}>
          {duration == null ? (
            NULL_DISPLAY
          ) : (
            <>
              lasts{" "}
              <Unit
                value={
                  from === undefined
                    ? value("s", duration)
                    : datedFrom(from, value("s", duration))
                }
              />
            </>
          )}
        </span>
      </Cluster>
      <Stack as="ul" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {rows.map((row) => (
          <InstantRow key={row.kind} row={row} nowUt={nowUt} from={from} />
        ))}
      </Stack>
      {axis && <BurnAxisBar axis={axis} rows={rows} />}
    </Stack>
  );
}
