import { value } from "@ksp-gonogo/sitrep-sdk";
import { useId } from "react";
import styled from "styled-components";
import { Unit } from "../Unit";

/**
 * Vanilla-safe display shapes, a deliberate LOCAL redeclaration (not an import
 * of `@ksp-gonogo/sitrep-client`'s `ControlStream`): this package carries no data
 * hooks and no gonogo-type imports, the same rule `InFlightList` follows. The
 * shapes are structurally compatible with the hook's return, so
 * `<ControlDelayStream streams={[useControlStream(...), ...]} />` type-checks.
 */
export interface ControlStreamSample {
  /** Seconds since issue: 0 = now (left), increasing rightward. */
  age: number;
  /** Value in the shared 0..1 band. */
  value: number;
}

export interface ControlStreamDatum {
  id: string;
  label: string;
  /** One-way delay seconds; the strip spans 3x this. null / near-zero => render nothing. */
  oneWaySeconds: number | null;
  inTransit: ControlStreamSample[];
  echo: ControlStreamSample[];
  current: number;
}

export interface ControlDelayStreamProps {
  /** All of a widget's local control axes on ONE graph. */
  streams: ControlStreamDatum[];
  /** Accessible label for the graph. Defaults to "Controls in flight". */
  ariaLabel?: string;
  /**
   * `"inline"` (default, 40px) keeps the in-widget Navball rendering at its
   * current size; `"rail"` (16px, no labels) is the collapsed drag-bar strip;
   * `"expanded"` (the grown/pinned view) is the full-width, taller graph with
   * NO box (full-bleed) plus always-visible zone labels, a legend, and a readout.
   */
  variant?: "inline" | "rail" | "expanded";
}

/** Local redeclaration of the model's floor (ui-kit imports nothing from sitrep-client). */
const MIN_DELAY_SECONDS = 0.05;
const DEVIATION_EPSILON = 0.02;

/** Soft distinct hues, in axis order (throttle, pitch, yaw, roll, ...). Wraps past four. */
const STREAM_TOKENS = [
  "--color-data-1",
  "--color-data-2",
  "--color-data-3",
  "--color-data-4",
] as const;

// viewBox units. Short height by design. Padding keeps strokes off the edges.
const VB_W = 100;
const VB_H = 30;
const PAD_X = 1.5;
const PAD_T = 2;
const PAD_B = 4;
const PLOT_H = VB_H - PAD_T - PAD_B;

// `padX` is variant-driven: the rail variant bleeds to 0 so the graph is flush
// to both widget edges (the inline variant keeps a small inset so strokes stay
// off the edge).
const xAt = (age: number, span: number, padX: number): number =>
  padX + (span <= 0 ? 0 : Math.min(1, age / span)) * (VB_W - padX * 2);
const yAt = (value: number): number =>
  PAD_T + (1 - Math.max(0, Math.min(1, value))) * PLOT_H;

function polyline(points: { x: number; y: number }[]): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");
}

/**
 * Clip the confirmed-echo line so it BEGINS exactly at the confirmed-stage
 * boundary (`2 * oneWay`, the same value the 2T divider is drawn from), never at
 * a stray earlier data age. The reply cannot be confirmed before it arrives at
 * 2T, so a sample before the boundary is dropped and an interpolated vertex is
 * placed at the boundary itself: the line's last-stage transition then lands ON
 * the divider, not before it (both derive from the one shared boundary).
 */
function clipToConfirmed(
  echo: ControlStreamSample[],
  boundaryAge: number,
): ControlStreamSample[] {
  if (echo.length === 0 || echo[0].age >= boundaryAge) return echo;
  const after = echo.findIndex((s) => s.age >= boundaryAge);
  if (after === -1) return []; // nothing confirmed yet
  const before = echo[after - 1];
  const first = echo[after];
  const span = first.age - before.age || 1;
  const t = (boundaryAge - before.age) / span;
  const value = before.value + t * (first.value - before.value);
  return [{ age: boundaryAge, value }, ...echo.slice(after)];
}

/** Commanded value interpolated at `age` (local copy; ui-kit imports no model). */
function commandedAt(
  inTransit: ControlStreamSample[],
  age: number,
): number | null {
  if (inTransit.length === 0) return null;
  const first = inTransit[0];
  const last = inTransit[inTransit.length - 1];
  if (age <= first.age) return first.value;
  if (age >= last.age) return last.value;
  for (let i = 1; i < inTransit.length; i++) {
    const b = inTransit[i];
    if (age <= b.age) {
      const a = inTransit[i - 1];
      const t = (age - a.age) / (b.age - a.age || 1);
      return a.value + t * (b.value - a.value);
    }
  }
  return last.value;
}

function StreamPaths({
  stream,
  span,
  index,
  padX,
  twoT,
}: {
  stream: ControlStreamDatum;
  span: number;
  index: number;
  padX: number;
  /** The 2T stage boundary AGE, the exact value the 2T divider is drawn from,
   *  so the confirmed line and the divider share one boundary (no drift). */
  twoT: number;
}) {
  const token = STREAM_TOKENS[index % STREAM_TOKENS.length];
  const colour = `var(${token})`;
  // `useId()`, not a hardcoded `cds-ramp-${index}`: two mounted
  // `ControlDelayStream` instances (two widgets, or two of the same widget)
  // would otherwise both emit `id="cds-ramp-0"`, and the SVG spec resolves
  // `url(#cds-ramp-0)` to whichever element is FIRST in document order, so
  // one instance's gradient silently wins for both.
  const uid = useId();
  const gradId = `cds-ramp-${uid}-${index}`;
  const fillId = `cds-fill-${uid}-${index}`;
  const cmd = stream.inTransit.map((s) => ({
    x: xAt(s.age, span, padX),
    y: yAt(s.value),
  }));
  if (cmd.length === 0) return null;

  // Soft area fill under the commanded line: a little glow so the trace pops
  // (v3 round 6). A vertical gradient, brightest just under the line and fading
  // to nothing, kept low-alpha so it reads as a glow, not a solid fill.
  const areaPath = `${polyline(cmd)} L${cmd[cmd.length - 1].x.toFixed(2)},${(PAD_T + PLOT_H).toFixed(2)} L${cmd[0].x.toFixed(2)},${(PAD_T + PLOT_H).toFixed(2)} Z`;

  // The confirmed-echo line is clipped to begin at the 2T stage boundary (the
  // exact `twoT` the 2T divider is drawn from), so its stage transition lands
  // exactly on the divider, never before it.
  const confirmedEcho = clipToConfirmed(stream.echo, twoT);
  const echoPts = confirmedEcho.map((s) => ({
    x: xAt(s.age, span, padX),
    y: yAt(s.value),
  }));
  const expectedPts = confirmedEcho.map((s) => ({
    x: xAt(s.age, span, padX),
    y: yAt(commandedAt(stream.inTransit, s.age) ?? s.value),
  }));
  // First confirmed sample (age-ascending) that diverges from the commanded
  // path past the epsilon. The actual-orange treatment stems FROM this point,
  // not the whole echo path: everything before it stays the ordinary
  // confirmed-zone treatment.
  const divergeIndex = confirmedEcho.findIndex((s) => {
    const c = commandedAt(stream.inTransit, s.age);
    return c !== null && Math.abs(s.value - c) > DEVIATION_EPSILON;
  });
  const diverged = divergeIndex !== -1;
  // The confirmed (pre-divergence) segment runs up to AND INCLUDING the
  // diverging sample, so the two segments share that vertex and the path
  // reads as one continuous line, not a gap.
  const confirmedPts = diverged ? echoPts.slice(0, divergeIndex + 1) : echoPts;
  const deviationPts = diverged ? echoPts.slice(divergeIndex) : [];
  const deviationExpectedPts = diverged ? expectedPts.slice(divergeIndex) : [];
  // Nothing precedes the divergence (it starts at the very first sample):
  // there is no genuine "confirmed, not yet diverged" segment to draw.
  const hasConfirmedPrefix = !diverged || divergeIndex > 0;

  return (
    <g>
      <defs>
        {/* Confidence ramp: muted left (least known) -> clear right (confirmed).
            v3 alpha budget 0.10 -> 0.40 (v2 was 0.30 -> 0.95): the rail is
            roughly a third of v2's ink, so a widget in flight reads as texture,
            not chrome. No area fill under the line (v3 drops all area fills). */}
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={colour} stopOpacity="0.10" />
          <stop offset="1" stopColor={colour} stopOpacity="0.40" />
        </linearGradient>
        {/* Under-line glow fill: brightest just below the trace, fading down. */}
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={colour} stopOpacity="0.22" />
          <stop offset="1" stopColor={colour} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        data-role="area"
        d={areaPath}
        fill={`url(#${fillId})`}
        stroke="none"
      />
      <path
        data-role="commanded"
        data-stream={stream.id}
        d={polyline(cmd)}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth="0.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {confirmedPts.length > 0 && hasConfirmedPrefix && (
        <path
          data-role="echo"
          data-stream={stream.id}
          d={polyline(confirmedPts)}
          fill="none"
          stroke={colour}
          strokeWidth="0.8"
          strokeLinecap="round"
        />
      )}
      {diverged && (
        <path
          data-role="deviation-actual"
          data-stream={stream.id}
          data-deviation="true"
          d={polyline(deviationPts)}
          fill="none"
          stroke="var(--color-status-warning-bg)"
          strokeWidth="1"
          strokeLinecap="round"
        />
      )}
      {diverged && (
        <path
          data-role="deviation-expected"
          data-stream={stream.id}
          d={polyline(deviationExpectedPts)}
          fill="none"
          stroke={colour}
          strokeWidth="0.8"
          strokeDasharray="2 1.5"
        />
      )}
    </g>
  );
}

/**
 * The continuous sibling of `InFlightList`: one gentle three-zone sparkline for
 * ALL of a widget's control axes. now-left / age-right; outgoing -> echo ->
 * confirmed split by hairline dividers at the one-way delay boundaries (T, 2T);
 * a left-muted -> right-clear confidence ramp (v3 alpha 0.10 -> 0.40, no area
 * fills); deviation in the confirmed zone as the expected path dashed in the
 * stream colour plus the actual path solid in the reserved orange warning token;
 * zone + delay labels on hover only. `variant="rail"` renders the 16px v3
 * drag-bar strip; `"inline"` (default) keeps the 40px in-widget size. Renders
 * `null` when the one-way delay is near zero, so a widget on a direct link pays
 * nothing. Props-only, no data hooks.
 */
export function ControlDelayStream({
  streams,
  ariaLabel = "Controls in flight",
  variant = "inline",
}: ControlDelayStreamProps) {
  // Before the early return (hooks run unconditionally): the divider-fade
  // gradient id.
  const dividerFadeId = `cds-divfade-${useId()}`;
  const first = streams[0];
  const oneWay = first?.oneWaySeconds ?? null;
  if (!first || oneWay === null || oneWay < MIN_DELAY_SECONDS) return null;

  const span = 3 * oneWay;
  // The two stage boundaries, computed ONCE and shared by the dividers AND the
  // confirmed-line clip, so a line can never change appearance anywhere except
  // exactly on a divider.
  const oneT = oneWay;
  const twoT = 2 * oneWay;
  // Full-bleed for the rail AND the expanded view: the graph reaches both widget
  // edges. Only the in-widget inline variant keeps the small stroke inset.
  const padX = variant === "inline" ? PAD_X : 0;
  const divX1 = xAt(oneT, span, padX);
  const divX2 = xAt(twoT, span, padX);
  /**
   * Nothing has been commanded yet, so the strip is two stage dividers in an
   * otherwise empty box.
   *
   * The zone labels stop being hover-only there. Empty and unlabelled, the strip
   * is indistinguishable from a row whose contents went missing, which is how it
   * was read in review; labelled, the same pixels say what the box is for. It
   * goes back to hover-only the moment there is a line to draw, so the labels
   * never compete with the data they annotate. Hiding the box instead is the
   * wrong trade: it would appear and vanish under the operator's hands as
   * commands come and go, on a surface where the buttons must not move.
   */
  const quiet = streams.every(
    (s) => s.inTransit.length === 0 && s.echo.length === 0,
  );

  return (
    <ControlDelayStream__Root
      aria-label={ariaLabel}
      data-oneway={oneWay}
      data-variant={variant}
      $variant={variant}
    >
      <ControlDelayStream__Svg
        $variant={variant}
        $quiet={quiet}
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="none"
      >
        <defs>
          {/* The dividers fade DOWN, matching the under-line shading (brightest
              at the top, dissolving toward the baseline) so they read as part of
              the same soft treatment rather than hard chrome. */}
          <linearGradient
            id={dividerFadeId}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1={PAD_T}
            x2="0"
            y2={PAD_T + PLOT_H}
          >
            <stop
              offset="0"
              stopColor="var(--color-border-subtle)"
              stopOpacity="0.9"
            />
            <stop
              offset="1"
              stopColor="var(--color-border-subtle)"
              stopOpacity="0"
            />
          </linearGradient>
        </defs>
        {streams.map((s, i) => (
          <StreamPaths
            key={s.id}
            stream={s}
            span={span}
            index={i}
            padX={padX}
            twoT={twoT}
          />
        ))}
        <line
          data-divider="t"
          x1={divX1}
          x2={divX1}
          y1={PAD_T}
          y2={PAD_T + PLOT_H}
          stroke={`url(#${dividerFadeId})`}
          strokeWidth="0.4"
        />
        <line
          data-divider="2t"
          x1={divX2}
          x2={divX2}
          y1={PAD_T}
          y2={PAD_T + PLOT_H}
          stroke={`url(#${dividerFadeId})`}
          strokeWidth="0.4"
        />
        {/* Hover-only zone + delay labels, INLINE variant only. The rail drops
            them (16px squashes them to noise) and the expanded view uses roomy
            HTML labels below instead. Hidden by default, revealed on hover (the
            static render is deterministic and the svg's own `role="img"` +
            aria-label carries the accessible name, so these are never announced
            separately). */}
        {variant === "inline" && (
          <g data-role="hover-labels">
            <text x={divX1} y={PAD_T - 0.4} textAnchor="middle" fontSize="2">
              <Unit value={value("s", oneWay)} decimals={1} />
            </text>
            <text x={divX2} y={PAD_T - 0.4} textAnchor="middle" fontSize="2">
              <Unit value={value("s", 2 * oneWay)} decimals={1} />
            </text>
            <text
              x={xAt(oneWay / 2, span, padX)}
              y={VB_H - 0.6}
              textAnchor="middle"
              fontSize="2"
            >
              outgoing
            </text>
            <text
              x={xAt(1.5 * oneWay, span, padX)}
              y={VB_H - 0.6}
              textAnchor="middle"
              fontSize="2"
            >
              echo
            </text>
            <text
              x={xAt(2.5 * oneWay, span, padX)}
              y={VB_H - 0.6}
              textAnchor="middle"
              fontSize="2"
            >
              confirmed
            </text>
          </g>
        )}
      </ControlDelayStream__Svg>
      {variant === "expanded" && (
        <>
          {/* Roomy HTML zone labels under the graph (not squashed svg text): the
              three delay stages, with the T / 2T boundary times. */}
          <ControlDelayStream__Zones aria-hidden="true">
            <span>
              outgoing <b>0</b>
            </span>
            <span>
              echo{" "}
              <b>
                <Unit value={value("s", oneWay)} decimals={1} />
              </b>
            </span>
            <span>
              confirmed{" "}
              <b>
                <Unit value={value("s", 2 * oneWay)} decimals={1} />
              </b>
            </span>
          </ControlDelayStream__Zones>
          {/* Per-axis legend: which coloured line is which control. */}
          <ControlDelayStream__Legend aria-hidden="true">
            {streams.map((s, i) => (
              <span key={s.id}>
                <i
                  style={{
                    background: `var(${STREAM_TOKENS[i % STREAM_TOKENS.length]})`,
                  }}
                />
                {s.label}
              </span>
            ))}
            <span data-role="legend-deviation">
              <i style={{ background: "var(--color-status-warning-bg)" }} />
              off-command
            </span>
          </ControlDelayStream__Legend>
        </>
      )}
    </ControlDelayStream__Root>
  );
}

const ControlDelayStream__Root = styled.div<{
  $variant: "inline" | "rail" | "expanded";
}>`
  flex: 0 0 auto;
  width: 100%;
  ${({ $variant }) =>
    $variant === "expanded" &&
    "display: flex; flex-direction: column; gap: var(--space-4, 4px);"}
`;

const ControlDelayStream__Svg = styled.svg<{
  $variant: "inline" | "rail" | "expanded";
  $quiet?: boolean;
}>`
  display: block;
  width: 100%;
  height: ${({ $variant }) =>
    $variant === "rail" ? "32px" : $variant === "expanded" ? "86px" : "40px"};

  /* Expanded (pinned) is a full-bleed, taller graph with NO box: the operator
     rejected the bordered box, the graph spans the full widget width edge to
     edge, just taller than the collapsed strip. No background / border / radius. */

  [data-role="hover-labels"] {
    opacity: ${({ $quiet }) => ($quiet ? 1 : 0)};
    fill: var(--color-text-muted);
    font-family: var(--font-family-mono);
  }
  &:hover [data-role="hover-labels"] {
    opacity: 1;
  }
`;

const ControlDelayStream__Zones = styled.div`
  display: flex;
  justify-content: space-between;
  /* The GRAPH and its dividers stay full-bleed, but the zone labels below it
     ("outgoing 0" / "echo ..." / "confirmed ...") taper inward to the standard
     content margin, same as the legend, so the outermost labels don't touch
     the widget edges. */
  margin: 0 var(--space-16, 16px);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  letter-spacing: 0.06em;

  b {
    color: var(--color-text-dim);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
`;

const ControlDelayStream__Legend = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4, 4px) var(--space-12, 12px);
  /* The GRAPH stays full-bleed, but the legend key sits at the standard content
     horizontal margin (not edge to edge, same as the zone labels above it), and
     carries a little bottom breathing since the pinned rail is padding-free. */
  margin: 0 var(--space-16, 16px) var(--space-4, 4px);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  letter-spacing: 0.06em;

  span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4, 4px);
  }
  i {
    display: inline-block;
    width: 10px;
    height: 2px;
  }
`;
