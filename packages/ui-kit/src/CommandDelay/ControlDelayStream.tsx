import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { Fragment, useId } from "react";
import styled from "styled-components";
import {
  heldNameMarker,
  InstrumentHeldMark,
  sayHeld,
} from "../instrumentCurrency";
import { resolveCurrency } from "../readingCurrency";
import { useTooltip } from "../Tooltip";
import { Unit } from "../Unit";
import { writeQuantity } from "../units";
import { withDelayCurrency } from "./delayCurrency";
import {
  type RailTags,
  railDrawsReturnLeg,
  railFlow,
  railRendererFor,
  railTagKey,
  railToneToken,
  reportUnrepresentedRail,
} from "./railTags";
import {
  WAVE_MID_Y,
  WAVE_VB_H,
  type WaveBlock,
  waveformBand,
  waveformExtentX,
  waveformPath,
} from "./waveformPath";

/**
 * One sample on a control axis's trace in {@link ControlDelayStream}: a
 * commanded value at a moment. Useful for showing the operator how a held
 * control, such as a throttle, has moved. Carried by {@link ControlStreamDatum}.
 *
 * @category CommandDelay
 */
export interface ControlStreamSample {
  /** Seconds since issue: 0 = now (left), increasing rightward. */
  age: number;
  /** Value in the shared 0..1 band. */
  value: number;
}

/**
 * One control axis drawn by {@link ControlDelayStream}: what is still on its
 * way to the vessel, what has come back, and the value commanded now. Useful
 * for showing the operator how a held control, such as a throttle, compares with
 * what the vessel reports. Taken by {@link ControlDelayStream}.
 *
 * @category CommandDelay
 */
export interface ControlStreamDatum {
  /** Identifies the axis. */
  id: string;
  /** The axis's name, e.g. "Throttle". */
  label: string;
  /** One-way delay in seconds; the strip spans three times this. Below {@link STREAM_MIN_DELAY_SECONDS}, or `null`, nothing is drawn. */
  oneWaySeconds: number | null;
  /** Commanded values still on their way to the craft. */
  inTransit: ControlStreamSample[];
  /** Values the craft has confirmed back. */
  echo: ControlStreamSample[];
  /** `null` while nothing has been commanded on the axis. */
  current: number | null;
  /**
   * What this entry is on the three axes, in full, and not optional. A control
   * axis gets them from `railTagsForControlAxis(writeCommand)`. A
   * `fire-and-forget` entry gets the outgoing zone only, since nothing comes
   * back to draw.
   */
  tags: RailTags;
}

/**
 * One continuous transmission on its way from the command centre to a vessel,
 * such as the operator's voice: its loudness per chunk, with no value and no
 * echo back. Useful for showing how far a transmission has travelled. Used by
 * {@link ControlDelayStream}, which draws it as the ribbon mark in the
 * outgoing zone. A {@link ControlStreamDatum} carries a commanded value and
 * its echo instead.
 *
 * @category CommandDelay
 */
export interface ControlRibbonDatum {
  /** Identifies the ribbon. */
  id: string;
  /** What the ribbon is, in a sentence, e.g. "Your transmission crossing to Odyssey". */
  label: string;
  /** One-way delay seconds, read the same way a stream datum's is. */
  oneWaySeconds: number | null;
  /**
   * The amplitude history, one value per sample in 0..1, newest last. Each
   * sample is drawn at its age, so a history shorter than the trip draws a
   * trace that stops short; keep a longer history to fill it.
   */
  amplitudes: readonly number[];
  /**
   * The lowest and highest sample of each block of `amplitudes`, from the same
   * audio, newest last. When present the ribbon is drawn as the wave itself, a
   * filled band from each slice's lowest sample to its highest, and
   * `amplitudes` is not drawn; absent, the ribbon is drawn from `amplitudes`
   * alone as a loudness trace.
   */
  wave?: readonly WaveBlock[];
  /**
   * How many samples span the signal delay. Defaults to the whole
   * array. Fractional below one and never floored: a short signal delay can be
   * a fraction of a single sample.
   */
  spanSamples?: number;
  /**
   * What this entry is on the three axes, in full, and not optional. A
   * producer builds them with {@link railTagsForTelemetry}, passing its
   * sample kind.
   */
  tags: RailTags;
}

/**
 * The three sizes of {@link ControlDelayStream}. Set with the `variant` prop;
 * see {@link ControlDelayStreamProps.variant}.
 * Useful for fitting the control delay stream into a line of text, the delay
 * rail or a widget body.
 *
 * @category CommandDelay
 */
export type ControlDelayStreamVariant = "inline" | "rail" | "expanded";

/**
 * Props for {@link ControlDelayStream}: the control axes and ribbons to draw,
 * and the one-way delay between the command centre and the vessel.
 * Useful for choosing which control axes the operator sees travelling to the
 * vessel and the delay they travel over. Used by {@link ControlDelayStream}.
 *
 * @category CommandDelay
 */
export interface ControlDelayStreamProps {
  /** All of a widget's local control axes on one graph. */
  streams: ControlStreamDatum[];
  /**
   * Continuous entries with no readback, drawn as ribbons in the outgoing zone
   * of the same graph, with nothing past the first boundary.
   */
  ribbons?: ControlRibbonDatum[];
  /** Accessible label for the graph. Defaults to "Controls in flight". */
  "aria-label"?: string;
  /**
   * `"inline"` (default, 40px) is the in-widget rendering; `"rail"` (16px, no
   * labels) is the collapsed drag-bar strip; `"expanded"` is the full-bleed,
   * taller graph with zone labels, a legend and a readout.
   */
  variant?: ControlDelayStreamVariant;
  /**
   * The one-way delay as the reading it arrived in, so the T and 2T figures
   * draw held while `comms.delay` is quiet. Omitted, they draw as current.
   */
  delayReading?: Reading<Value<"s">> | null;
}

/**
 * The one-way delay, in seconds, under which {@link ControlDelayStream} draws no
 * command streams. Ribbons draw at any positive delay. Useful for deciding
 * whether the operator sees a stream at a given delay. Read by
 * {@link ControlDelayStream}.
 *
 * @intent Published so a representation of the rail of a third party can agree with ControlDelayStream on when streams are drawn.
 * @category CommandDelay
 */
export const STREAM_MIN_DELAY_SECONDS = 0.05;

/**
 * Whether a one-way delay is a real, positive figure. A ribbon draws at any
 * such delay, however short, because the zone it crosses is scaled to the
 * delay and the trace is sized by the audio, not by the gap; only a delay that
 * is exactly zero or unknown has nothing to cross. Used by the rail to decide
 * whether to mount around a ribbon.
 */
export function hasRealDelay(
  oneWay: number | null | undefined,
): oneWay is number {
  return typeof oneWay === "number" && Number.isFinite(oneWay) && oneWay > 0;
}
const DEVIATION_EPSILON = 0.02;
/**
 * How far either side of its predicted moment a reading may be matched to the
 * command, in seconds: a reading comes home on the telemetry's own cadence, up
 * to a report interval after the round trip, so across a change it can still
 * show the value before it.
 */
const READING_LATENESS_SECONDS = 1.5;
/** How close to the rail's far end the oldest command must be for the history to count as running past it: a little over one 10 Hz sample. */
const HISTORY_EDGE_SECONDS = 0.25;

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

const xAt = (age: number, span: number, padX: number): number =>
  padX + (span <= 0 ? 0 : Math.min(1, age / span)) * (VB_W - padX * 2);
const yAt = (value: number): number =>
  PAD_T + (1 - Math.max(0, Math.min(1, value))) * PLOT_H;

/** The stroke inset, which only the in-widget inline variant keeps. */
const padXFor = (variant: ControlDelayStreamVariant): number =>
  variant === "inline" ? PAD_X : 0;

/**
 * Where the first divider (T, one signal delay) sits for a ribbon, in the
 * graph's viewBox x units (100 wide): a third of the plot. It never moves with
 * delivery; delivery only decides whether anything is drawn past it. Useful for
 * placing a transmission's divider where the operator expects it. Used by
 * {@link ControlDelayStream}.
 *
 * @intent Published so a representation of the rail of a third party can place its divider where ControlDelayStream places the T.
 * @category CommandDelay
 */
export function ribbonBoundaryX(
  variant: ControlDelayStreamVariant = "inline",
): number {
  const padX = padXFor(variant);
  return (VB_W - padX * 2) / 3;
}

/**
 * An entry whose declared combination nothing draws: zero ink, an addressable
 * marker (`data-rail-unrepresented`), and one report per combination through
 * {@link reportUnrepresentedRail}. Reported in render, not an effect, because a
 * static render runs no effects; the reporter is idempotent.
 */
function UnrepresentedRailEntry({
  tags,
  who,
}: {
  tags: RailTags;
  who: string;
}) {
  reportUnrepresentedRail(tags, who);
  return <g data-rail-unrepresented={railTagKey(tags)} data-rail-entry={who} />;
}

function polyline(points: { x: number; y: number }[]): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");
}

/**
 * Clip the confirmed-echo line so it begins exactly at the 2T divider: nothing
 * is confirmed before it arrives, so earlier samples drop and an interpolated
 * vertex lands on the divider.
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

/**
 * Clip a line so it ends exactly at the outgoing-stage boundary (`oneWay`, the
 * same value the T divider is drawn from), the mirror of `clipToConfirmed`.
 *
 * What a `fire-and-forget` entry gets for its solid leg. An interpolated vertex
 * is placed on the boundary itself so the line's end lands on the divider rather
 * than short of or past it; what happens immediately past the divider is
 * {@link OUTGOING_TAIL}'s business, and it is not this line.
 */
function clipToOutgoing(
  samples: ControlStreamSample[],
  boundaryAge: number,
): ControlStreamSample[] {
  if (samples.length === 0) return samples;
  const last = samples[samples.length - 1];
  if (last.age <= boundaryAge) return samples;
  const after = samples.findIndex((s) => s.age > boundaryAge);
  const kept = samples.slice(0, after);
  const first = samples[after];
  const before = kept[kept.length - 1];
  if (!before) return [{ age: boundaryAge, value: first.value }];
  const span = first.age - before.age || 1;
  const t = (boundaryAge - before.age) / span;
  return [
    ...kept,
    {
      age: boundaryAge,
      value: before.value + t * (first.value - before.value),
    },
  ];
}

/**
 * How far past the T divider a fire-and-forget leg trails off, as a fraction of
 * one signal delay. A sample past the boundary has arrived, so the trace fades
 * rather than stopping dead; short enough to read as an ending, not a second
 * leg.
 */
const OUTGOING_TAIL = 0.25;

/**
 * Commanded value interpolated at `age` (local copy; ui-kit imports no model).
 * `null` past the oldest sample: nothing had been commanded that long ago, so a
 * readback at that age has no command to differ from.
 */
function commandedAt(
  inTransit: ControlStreamSample[],
  age: number,
): number | null {
  if (inTransit.length === 0) return null;
  const first = inTransit[0];
  const last = inTransit[inTransit.length - 1];
  if (age <= first.age) return first.value;
  if (age > last.age) return null;
  if (age === last.age) return last.value;
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

/**
 * The confirmed readings split into runs that agree with the command and runs
 * that do not, by index into `echo`. Neighbouring runs share their boundary
 * reading, so the line is drawn unbroken. A reading agrees when it lies within
 * the range the command took in the {@link READING_LATENESS_SECONDS} either
 * side of its moment. One whose allowance reaches back before the first
 * command on the rail always agrees, since what the craft was told then is
 * unknown.
 */
function offCommandRuns(
  echo: readonly ControlStreamSample[],
  inTransit: ControlStreamSample[],
  span: number,
): { from: number; to: number; off: boolean }[] {
  // History reaching the rail's far end was cut there, and its oldest value held before it.
  const heldPastRail =
    inTransit.length > 0 &&
    inTransit[inTransit.length - 1].age >= span - HISTORY_EDGE_SECONDS;
  const off = echo.map((s) => {
    if (commandedAt(inTransit, s.age) === null) return false;
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    const take = (v: number | null) => {
      if (v === null) return;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    };
    const from = s.age - READING_LATENESS_SECONDS;
    const to = s.age + READING_LATENESS_SECONDS;
    let before = commandedAt(inTransit, to);
    if (before === null) {
      if (!heldPastRail) return false;
      before = inTransit[inTransit.length - 1].value;
    }
    take(commandedAt(inTransit, from));
    take(before);
    for (const c of inTransit) if (c.age > from && c.age < to) take(c.value);
    return s.value < lo - DEVIATION_EPSILON || s.value > hi + DEVIATION_EPSILON;
  });
  const runs: { from: number; to: number; off: boolean }[] = [];
  let from = 0;
  for (let i = 1; i <= off.length; i++) {
    if (i < off.length && off[i] === off[from]) continue;
    runs.push({ from, to: Math.min(i, off.length - 1), off: off[from] });
    from = i;
  }
  return runs;
}

function StreamPaths({
  stream,
  span,
  index,
  padX,
  oneT,
  twoT,
}: {
  stream: ControlStreamDatum;
  span: number;
  index: number;
  padX: number;
  /** The T stage boundary age, where a fire-and-forget entry's leg out ends. */
  oneT: number;
  /** The 2T stage boundary age, the same value the 2T divider is drawn from. */
  twoT: number;
}) {
  const token = STREAM_TOKENS[index % STREAM_TOKENS.length];
  const colour = `var(${token})`;
  // Per-instance ids: `url(#id)` resolves to the first match in the document, so a shared literal lets one instance's gradient win for both.
  const uid = useId();
  const gradId = `cds-ramp-${uid}-${index}`;
  const fillId = `cds-fill-${uid}-${index}`;
  const tailId = `cds-tail-${uid}-${index}`;
  /*
   * Whether this strip draws the entry at all comes from the renderer table. A
   * combination nothing draws is REPORTED, ahead of the geometry so an empty
   * buffer is reported too.
   */
  const renderer = railRendererFor(stream.tags);
  if (renderer !== "continuous-strip") {
    return renderer === null ? (
      <UnrepresentedRailEntry tags={stream.tags} who={stream.id} />
    ) : null;
  }
  /*
   * DELIVERY alone decides this. Acked, the line runs the whole strip against
   * its confirmed echo; fire-and-forget, it gets the leg out plus the short
   * dissolving tail, and no return leg. The dividers never move.
   */
  const returnLeg = railDrawsReturnLeg(stream.tags);
  const outgoing = returnLeg
    ? stream.inTransit
    : clipToOutgoing(stream.inTransit, oneT);
  const cmd = outgoing.map((s) => ({
    x: xAt(s.age, span, padX),
    y: yAt(s.value),
  }));
  if (cmd.length === 0) return null;
  /*
   * The fire-and-forget tail: the segment between T and the tail's end, built
   * from the two existing clips so it starts on the vertex the solid leg ends
   * on. No sample moves; every vertex keeps the x its own age gives it.
   */
  const tail = returnLeg
    ? []
    : clipToOutgoing(
        clipToConfirmed(stream.inTransit, oneT),
        oneT * (1 + OUTGOING_TAIL),
      );
  const tailPts = tail.map((s) => ({
    x: xAt(s.age, span, padX),
    y: yAt(s.value),
  }));
  // A gradient with no extent paints one flat colour, so a zero-width tail is not drawn.
  const drawsTail =
    tailPts.length > 1 && tailPts[tailPts.length - 1].x > tailPts[0].x;

  // Low-alpha glow under the commanded line, fading downward.
  const areaPath = `${polyline(cmd)} L${cmd[cmd.length - 1].x.toFixed(2)},${(PAD_T + PLOT_H).toFixed(2)} L${cmd[0].x.toFixed(2)},${(PAD_T + PLOT_H).toFixed(2)} Z`;

  const confirmedEcho = returnLeg ? clipToConfirmed(stream.echo, twoT) : [];
  const echoPts = confirmedEcho.map((s) => ({
    x: xAt(s.age, span, padX),
    y: yAt(s.value),
  }));
  const expectedPts = confirmedEcho.map((s) => ({
    x: xAt(s.age, span, padX),
    y: yAt(commandedAt(stream.inTransit, s.age) ?? s.value),
  }));
  const runs = offCommandRuns(confirmedEcho, stream.inTransit, span);
  /*
   * The readings older than anything this screen commanded have no commanded
   * line above them to carry the glow, so they carry it themselves from where
   * the commanded shading ends.
   */
  const shadeFrom = outgoing[outgoing.length - 1].age;
  const shadeStart = commandedAt(confirmedEcho, shadeFrom);
  const shade = confirmedEcho.filter((s) => s.age > shadeFrom);
  const shadePts = (
    shadeStart === null || shade.length === 0
      ? shade
      : [{ age: shadeFrom, value: shadeStart }, ...shade]
  ).map((s) => ({ x: xAt(s.age, span, padX), y: yAt(s.value) }));
  const shadePath =
    shadePts.length > 1
      ? `${polyline(shadePts)} L${shadePts[shadePts.length - 1].x.toFixed(2)},${(PAD_T + PLOT_H).toFixed(2)} L${shadePts[0].x.toFixed(2)},${(PAD_T + PLOT_H).toFixed(2)} Z`
      : null;
  return (
    <g data-stream-group={stream.id} data-return-leg={returnLeg}>
      <defs>
        {/*
          Confidence ramp: muted left (least known) to clear right, kept faint
          so the rail reads as texture. In user space over the line's own run,
          because a flat line's box has no height and an objectBoundingBox ramp
          would not paint it.
        */}
        <linearGradient
          id={gradId}
          gradientUnits="userSpaceOnUse"
          x1={cmd[0].x}
          y1="0"
          x2={Math.max(cmd[cmd.length - 1].x, cmd[0].x + 1)}
          y2="0"
        >
          <stop offset="0" stopColor={colour} stopOpacity="0.10" />
          <stop offset="1" stopColor={colour} stopOpacity="0.40" />
        </linearGradient>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={colour} stopOpacity="0.22" />
          <stop offset="1" stopColor={colour} stopOpacity="0" />
        </linearGradient>
        {/*
          The tail's dissolve starts at the ramp's right-hand alpha. In user
          space, because a flat line's bounding box has no height and an
          objectBoundingBox ramp would not paint it.
        */}
        {drawsTail && (
          <linearGradient
            id={tailId}
            gradientUnits="userSpaceOnUse"
            x1={tailPts[0].x}
            y1="0"
            x2={tailPts[tailPts.length - 1].x}
            y2="0"
          >
            <stop offset="0" stopColor={colour} stopOpacity="0.40" />
            <stop offset="1" stopColor={colour} stopOpacity="0" />
          </linearGradient>
        )}
      </defs>
      <path
        data-role="area"
        d={areaPath}
        fill={`url(#${fillId})`}
        stroke="none"
      />
      {shadePath && (
        <path
          data-role="echo-area"
          d={shadePath}
          fill={`url(#${fillId})`}
          stroke="none"
        />
      )}
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
      {drawsTail && (
        <path
          data-role="commanded-tail"
          data-stream={stream.id}
          d={polyline(tailPts)}
          fill="none"
          stroke={`url(#${tailId})`}
          strokeWidth="0.8"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {runs.map((run) =>
        run.off ? (
          <Fragment key={run.from}>
            <path
              data-role="deviation-actual"
              data-stream={stream.id}
              data-deviation="true"
              d={polyline(echoPts.slice(run.from, run.to + 1))}
              fill="none"
              stroke="var(--color-warn-mark)"
              strokeWidth="1"
              strokeLinecap="round"
            />
            <path
              data-role="deviation-expected"
              data-stream={stream.id}
              d={polyline(expectedPts.slice(run.from, run.to + 1))}
              fill="none"
              stroke={colour}
              strokeWidth="0.8"
              strokeDasharray="2 1.5"
            />
          </Fragment>
        ) : (
          run.to > run.from && (
            <path
              key={run.from}
              data-role="echo"
              data-stream={stream.id}
              d={polyline(echoPts.slice(run.from, run.to + 1))}
              fill="none"
              stroke={colour}
              strokeWidth="0.8"
              strokeLinecap="round"
            />
          )
        ),
      )}
    </g>
  );
}

/**
 * The ribbon mark: one continuous entry's amplitude history, lying along one
 * zone of the strip. Each axis lands on one property:
 *
 * - Continuity puts it on this strip at all; a discrete datum draws nothing
 * - Direction places it and picks its tone: a command lies in the outgoing zone
 *   in the accent tone, telemetry lies in the confirmed zone, past the second
 *   divider, in the info tone
 * - Delivery decides only whether a return leg is drawn, which a ribbon has no
 *   use for
 *
 * Drawn in the waveform's own 16-unit box and scaled into the plot band.
 */
function RibbonMark({
  ribbon,
  padX,
}: {
  ribbon: ControlRibbonDatum;
  padX: number;
}) {
  // Per-instance, since `url(#id)` resolves to the first match in the document.
  const fadeId = `cds-ribbon-fade-${useId()}`;
  const tags = ribbon.tags;
  // The same renderer table `StreamPaths` asks.
  const renderer = railRendererFor(tags);
  if (renderer !== "continuous-strip") {
    return renderer === null ? (
      <UnrepresentedRailEntry tags={tags} who={ribbon.id} />
    ) : null;
  }

  const boundaryX = (VB_W - padX * 2) / 3;
  const wave = ribbon.wave;
  const samples = wave ?? ribbon.amplitudes;
  const span = ribbon.spanSamples ?? samples.length;
  // The wave itself when the producer kept it, else the loudness trace.
  const band = wave !== undefined ? waveformBand(wave, span, boundaryX) : "";
  const path =
    wave !== undefined
      ? band
      : waveformPath(ribbon.amplitudes, span, boundaryX);
  // A ribbon with nothing in it is not a crossing.
  if (path === "" && !(wave !== undefined && wave.length > 0)) return null;

  // The fade spans the trace's own length, at least a unit so the gradient has extent.
  const fadeX = Math.max(
    waveformExtentX(wave ?? ribbon.amplitudes, span, boundaryX),
    1,
  );
  const tone = `var(${railToneToken(tags)})`;
  // What arrives lies past the second divider, where what has been confirmed is drawn.
  const outbound = railFlow(tags) === "outbound";
  const zoneStartX = outbound ? 0 : 2 * boundaryX;

  return (
    <g
      data-ribbon-group={ribbon.id}
      data-ribbon-zone={zoneStartX === 0 ? "outgoing" : "confirmed"}
      // The waveform's 16-unit box mapped onto the plot band.
      transform={`translate(${padX + zoneStartX} ${PAD_T}) scale(1 ${PLOT_H / WAVE_VB_H})`}
    >
      <defs>
        {/* The fade runs the way the entry does, in user space so a flat passage still paints. */}
        <linearGradient
          id={fadeId}
          gradientUnits="userSpaceOnUse"
          x1={outbound ? 0 : fadeX}
          y1="0"
          x2={outbound ? fadeX : 0}
          y2="0"
        >
          {/* Nearer full strength than a filled ribbon would carry: a hairline
              trace at 0.55 is most of the way to invisible where a broad fill at
              the same value still read. */}
          <stop offset="0" stopColor={tone} stopOpacity="0.9" />
          <stop offset="1" stopColor={tone} stopOpacity="0.1" />
        </linearGradient>
      </defs>
      {/* Stroked in SCREEN units: the box is stretched to the widget's width
          AND scaled vertically into the band, so a scaled stroke would come out
          several times thicker across than it is tall and the near-vertical
          parts of the trace would fatten into a blob. */}
      {wave !== undefined ? (
        <>
          {/* Silence is a line along the centre, and the wave stands on it. */}
          <line
            data-role="ribbon-axis"
            x1="0"
            x2={fadeX}
            y1={WAVE_MID_Y}
            y2={WAVE_MID_Y}
            stroke={`url(#${fadeId})`}
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          {band !== "" && (
            <path
              data-role="ribbon"
              data-ribbon={ribbon.id}
              d={band}
              fill={`url(#${fadeId})`}
              stroke="none"
            />
          )}
        </>
      ) : (
        <path
          data-role="ribbon"
          data-ribbon={ribbon.id}
          d={path}
          fill="none"
          stroke={`url(#${fadeId})`}
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  );
}

/**
 * A three-zone sparkline for all of a widget's control axes, the continuous
 * sibling of {@link InFlightList}. Now is on the left and age to the right; the
 * outgoing, echo and confirmed zones are split by dividers at T and 2T; a
 * muted-to-clear confidence ramp; deviation in the confirmed zone is drawn as
 * the expected path dashed plus the actual path in the warning token; zone and
 * delay labels show on hover. Useful for showing the operator that a held
 * control, such as a throttle or a voice transmission, takes effect after the
 * one-way delay, and whether the vessel answered as expected. Used by the radio
 * push-to-talk control. Renders `null` when the one-way delay is zero or
 * unknown, and draws no command streams under {@link STREAM_MIN_DELAY_SECONDS};
 * a ribbon draws at any positive delay. It reads nothing itself: everything
 * comes in through props.
 *
 * A continuous entry with no readback (the operator's voice) is drawn as a
 * ribbon in the outgoing zone of the same graph. Delivery only decides whether
 * anything is drawn past the first boundary; it never moves a boundary or picks
 * a different picture.
 *
 * @category CommandDelay
 */
export function ControlDelayStream({
  streams,
  ribbons = [],
  "aria-label": ariaLabel = "Controls in flight",
  variant = "inline",
  delayReading,
}: ControlDelayStreamProps) {
  // Every entry crosses the same gap, so the first one that knows its light-time serves the strip.
  const first = [...streams, ...ribbons].find((e) => e.oneWaySeconds !== null);
  const oneWay = first?.oneWaySeconds ?? null;
  if (!first || !hasRealDelay(oneWay)) return null;
  return (
    <DelayBand
      oneWay={oneWay}
      streams={streams}
      ribbons={ribbons}
      ariaLabel={ariaLabel}
      variant={variant}
      delayReading={delayReading}
    />
  );
}

/**
 * The graph the strip is drawn on: its T and 2T marks and, opened, the zone
 * labels under it. With no streams or ribbons it is the empty graph, which is
 * what the opened rail draws over a command press.
 */
export function DelayBand({
  oneWay,
  streams = [],
  ribbons = [],
  ariaLabel = "Controls in flight",
  variant,
  delayReading,
}: {
  oneWay: number;
  streams?: ControlDelayStreamProps["streams"];
  ribbons?: NonNullable<ControlDelayStreamProps["ribbons"]>;
  ariaLabel?: string;
  variant: ControlDelayStreamVariant;
  delayReading?: ControlDelayStreamProps["delayReading"];
}) {
  // Before the early return, so the hook runs unconditionally.
  const dividerFadeId = `cds-divfade-${useId()}`;
  const delayHeld = delayReading?.state === "held";
  const delayCaption = delayHeld
    ? resolveCurrency(delayReading ?? null).caption
    : null;
  const { anchor, tip } = useTooltip(delayCaption);
  const drawStreams = oneWay >= STREAM_MIN_DELAY_SECONDS;
  if (!drawStreams && ribbons.length === 0) return null;

  const span = 3 * oneWay;
  // Computed once and shared by the dividers and the line clips, so a line changes appearance only on a divider.
  const oneT = oneWay;
  const twoT = 2 * oneWay;
  const padX = padXFor(variant);
  const divX1 = xAt(oneT, span, padX);
  const divX2 = xAt(twoT, span, padX);
  /*
   * Nothing commanded yet: the zone labels show without hover, so an empty
   * strip does not read as missing data. The box itself never hides, so the
   * surface does not move under the operator's hands.
   */
  const quiet =
    streams.every((s) => s.inTransit.length === 0 && s.echo.length === 0) &&
    ribbons.every((r) => r.amplitudes.length === 0);

  return (
    <ControlDelayStream__Root
      data-oneway={oneWay}
      data-variant={variant}
      $variant={variant}
      {...anchor}
    >
      <ControlDelayStream__Svg
        $variant={variant}
        $quiet={quiet}
        role="img"
        aria-label={sayHeld(ariaLabel, delayCaption)}
        {...heldNameMarker(delayCaption)}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="none"
      >
        <defs>
          {/* The dividers fade downward, matching the under-line shading. */}
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
        {(drawStreams ? streams : []).map((s, i) => (
          <StreamPaths
            key={s.id}
            stream={s}
            span={span}
            index={i}
            padX={padX}
            oneT={oneT}
            twoT={twoT}
          />
        ))}
        {ribbons.map((r) => (
          <RibbonMark key={r.id} ribbon={r} padX={padX} />
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
        {/* Hover-only labels, inline variant only; the svg's own aria-label carries the accessible name. */}
        {variant === "inline" && (
          <g data-role="hover-labels">
            <text x={divX1} y={PAD_T - 0.4} textAnchor="middle" fontSize="2">
              {writeQuantity(value("s", oneWay), { decimals: 1 })}
              {delayHeld && <InstrumentHeldMark size={1.2} />}
            </text>
            <text x={divX2} y={PAD_T - 0.4} textAnchor="middle" fontSize="2">
              {writeQuantity(value("s", 2 * oneWay), { decimals: 1 })}
              {delayHeld && <InstrumentHeldMark size={1.2} />}
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
          {/* HTML zone labels under the graph, with the T and 2T boundary times. */}
          <ControlDelayStream__Zones aria-hidden="true">
            <span>
              outgoing <b>0</b>
            </span>
            <span>
              echo{" "}
              <b>
                <Unit
                  value={withDelayCurrency(value("s", oneWay), delayReading)}
                  decimals={1}
                />
              </b>
            </span>
            <span>
              confirmed{" "}
              <b>
                <Unit
                  value={withDelayCurrency(
                    value("s", 2 * oneWay),
                    delayReading,
                  )}
                  decimals={1}
                />
              </b>
            </span>
          </ControlDelayStream__Zones>
          <ControlDelayStream__Legend aria-hidden="true">
            {(drawStreams ? streams : []).map((s, i) => (
              <span key={s.id}>
                <i
                  style={{
                    background: `var(${STREAM_TOKENS[i % STREAM_TOKENS.length]})`,
                  }}
                />
                {s.label}
              </span>
            ))}
            {ribbons.map((r) => (
              <span key={r.id} data-role="legend-ribbon">
                <i
                  style={{
                    background: `var(${railToneToken(r.tags)})`,
                  }}
                />
                {r.label}
              </span>
            ))}
            {/* Ribbons have no commanded path to deviate from. */}
            {drawStreams && streams.length > 0 && (
              <span data-role="legend-deviation">
                <i style={{ background: "var(--color-warn-mark)" }} />
                off-command
              </span>
            )}
          </ControlDelayStream__Legend>
        </>
      )}
      {tip}
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
    "display: flex; flex-direction: column; gap: var(--gap-delay-stream);"}
`;

const ControlDelayStream__Svg = styled.svg<{
  $variant: "inline" | "rail" | "expanded";
  $quiet?: boolean;
}>`
  display: block;
  width: 100%;
  /* The rail height is the band the Panel reserves, not a size the graph chose. */
  height: ${({ $variant }) =>
    $variant === "rail"
      ? "var(--panel-rail-band)"
      : $variant === "expanded"
        ? "86px"
        : "40px"};

  /* Strokes are scaled by 30/16 against the stretched 30-unit viewBox, so the trace is a real pixel wide in the band. */
  ${({ $variant }) =>
    $variant === "rail"
      ? `[data-role="commanded"],
         [data-role="echo"],
         [data-role="deviation-expected"] { stroke-width: 1.5; }
         [data-role="deviation-actual"] { stroke-width: 1.88; }`
      : ""}


  /* The closed strip is too thin to carry the marks; they stay in the drawing so the lines still change appearance at them. */
  ${({ $variant }) =>
    $variant === "rail" ? `[data-divider] { display: none; }` : ""}

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
  /* The graph stays full-bleed; the zone labels inset to the standard content margin. */
  margin: 0 var(--gutter-panel);
  font-size: var(--font-size-caption);
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
  gap: var(--gap-legend);
  /* The legend sits at the standard content margin, with bottom room since the pinned rail has no padding. */
  margin: var(--outset-delay-legend);
  font-size: var(--font-size-caption);
  color: var(--color-text-muted);
  letter-spacing: 0.06em;

  span {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-glyph);
  }
  i {
    display: inline-block;
    width: 10px;
    height: 2px;
  }
`;
