import { useId } from "react";
import styled from "styled-components";

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
const PLOT_W = VB_W - PAD_X * 2;
const PLOT_H = VB_H - PAD_T - PAD_B;

const xAt = (age: number, span: number): number =>
  PAD_X + (span <= 0 ? 0 : Math.min(1, age / span)) * PLOT_W;
const yAt = (value: number): number =>
  PAD_T + (1 - Math.max(0, Math.min(1, value))) * PLOT_H;

function polyline(points: { x: number; y: number }[]): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");
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
}: {
  stream: ControlStreamDatum;
  span: number;
  index: number;
}) {
  const token = STREAM_TOKENS[index % STREAM_TOKENS.length];
  const colour = `var(${token})`;
  // `useId()`, not a hardcoded `cds-ramp-${index}`: two mounted
  // `ControlDelayStream` instances (two widgets, or two of the same widget)
  // would otherwise both emit `id="cds-ramp-0"`, and the SVG spec resolves
  // `url(#cds-ramp-0)` to whichever element is FIRST in document order, so
  // one instance's gradient silently wins for both.
  const gradId = `cds-ramp-${useId()}-${index}`;
  const cmd = stream.inTransit.map((s) => ({
    x: xAt(s.age, span),
    y: yAt(s.value),
  }));
  if (cmd.length === 0) return null;

  const areaPath =
    polyline(cmd) +
    ` L${cmd[cmd.length - 1].x.toFixed(2)},${(PAD_T + PLOT_H).toFixed(2)}` +
    ` L${cmd[0].x.toFixed(2)},${(PAD_T + PLOT_H).toFixed(2)} Z`;

  const echoPts = stream.echo.map((s) => ({
    x: xAt(s.age, span),
    y: yAt(s.value),
  }));
  const expectedPts = stream.echo.map((s) => ({
    x: xAt(s.age, span),
    y: yAt(commandedAt(stream.inTransit, s.age) ?? s.value),
  }));
  // First echo sample (age-ascending, same order as `stream.echo`) that
  // diverges from the commanded path past the epsilon. The actual-orange
  // treatment stems FROM this point, not the whole echo path: everything
  // before it stays the ordinary confirmed-zone treatment.
  const divergeIndex = stream.echo.findIndex((s) => {
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
        {/* Confidence ramp: muted left (least known) -> clear right (confirmed). */}
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={colour} stopOpacity="0.30" />
          <stop offset="0.5" stopColor={colour} stopOpacity="0.55" />
          <stop offset="1" stopColor={colour} stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={colour} fillOpacity="0.10" stroke="none" />
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
 * a left-muted -> right-clear confidence ramp; soft area fills; deviation in the
 * confirmed zone as the expected path dashed in the stream colour plus the actual
 * path solid in the reserved orange warning token; zone + delay labels on hover
 * only. Renders `null` when the one-way delay is near zero, so a widget on a
 * direct link pays nothing. Props-only, no data hooks.
 */
export function ControlDelayStream({
  streams,
  ariaLabel = "Controls in flight",
}: ControlDelayStreamProps) {
  const first = streams[0];
  const oneWay = first?.oneWaySeconds ?? null;
  if (!first || oneWay === null || oneWay < MIN_DELAY_SECONDS) return null;

  const span = 3 * oneWay;
  const divX1 = xAt(oneWay, span);
  const divX2 = xAt(2 * oneWay, span);

  return (
    <ControlDelayStream__Root aria-label={ariaLabel} data-oneway={oneWay}>
      <ControlDelayStream__Svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="none"
      >
        {streams.map((s, i) => (
          <StreamPaths key={s.id} stream={s} span={span} index={i} />
        ))}
        <line
          data-divider="t"
          x1={divX1}
          x2={divX1}
          y1={PAD_T}
          y2={PAD_T + PLOT_H}
          stroke="var(--color-border-subtle)"
          strokeWidth="0.4"
        />
        <line
          data-divider="2t"
          x1={divX2}
          x2={divX2}
          y1={PAD_T}
          y2={PAD_T + PLOT_H}
          stroke="var(--color-border-subtle)"
          strokeWidth="0.4"
        />
        {/* Hover-only labels: hidden by default, revealed on hover, so the static
            render is deterministic and screen readers get the aria-label, not this.
            The parent svg carries `role="img"` + an aria-label, so it is a leaf in
            the accessibility tree and these labels are never announced separately. */}
        <g data-role="hover-labels">
          <text x={divX1} y={PAD_T - 0.4} textAnchor="middle" fontSize="2">
            {oneWay.toFixed(1)}s
          </text>
          <text x={divX2} y={PAD_T - 0.4} textAnchor="middle" fontSize="2">
            {(2 * oneWay).toFixed(1)}s
          </text>
          <text
            x={xAt(oneWay / 2, span)}
            y={VB_H - 0.6}
            textAnchor="middle"
            fontSize="2"
          >
            outgoing
          </text>
          <text
            x={xAt(1.5 * oneWay, span)}
            y={VB_H - 0.6}
            textAnchor="middle"
            fontSize="2"
          >
            echo
          </text>
          <text
            x={xAt(2.5 * oneWay, span)}
            y={VB_H - 0.6}
            textAnchor="middle"
            fontSize="2"
          >
            confirmed
          </text>
        </g>
      </ControlDelayStream__Svg>
    </ControlDelayStream__Root>
  );
}

const ControlDelayStream__Root = styled.div`
  flex: 0 0 auto;
  width: 100%;
`;

const ControlDelayStream__Svg = styled.svg`
  display: block;
  width: 100%;
  height: 40px;

  [data-role="hover-labels"] {
    opacity: 0;
    fill: var(--color-text-muted);
    font-family: var(--font-family-mono);
  }
  &:hover [data-role="hover-labels"] {
    opacity: 1;
  }
`;
