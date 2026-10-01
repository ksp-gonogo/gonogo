import type {
  ComponentDefinition,
  ComponentProps,
  TinyEssential,
  TinyGauge,
  TinyMode,
  Tone,
  Value,
} from "@ksp-gonogo/sitrep-sdk";
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import styled from "styled-components";
import { fillFraction } from "./fillQuantity";
import { LevelBars } from "./LevelBars";
import { LiveRegion } from "./LiveRegion";
import { Panel } from "./Panel";
import { resolveCurrency } from "./readingCurrency";
import { Section } from "./Section";
import { ToggleButton } from "./ToggleButton";
import { TONE_MARK, TONE_TEXT } from "./tone";
import { Unit } from "./Unit";
import { VisuallyHidden } from "./VisuallyHidden";
import { TINY_BELOW } from "./widgetSize";

/**
 * Props for {@link TinyEssentials}: a widget's tiny heading and its essentials.
 *
 * @category TinyEssentials
 */
export interface TinyEssentialsProps {
  title: string;
  essentials: readonly TinyEssential[];
}

/**
 * The form every widget with a tiny mode takes at the tiny size, drawn in a
 * {@link Panel} with `hoverTitle` and `fitToSize`: its short heading over its
 * essential values, the first drawn large and the rest as
 * label and figure rows under it. A state word stands in a figure's place and
 * is announced through the tile's one polite live region, or, while its
 * essential declares it urgent, through an assertive one that interrupts.
 *
 * Rows are drawn in order while they fit the tile and the ones that do not
 * are dropped from the end, so every figure the tile shows is whole.
 *
 * @category TinyEssentials
 */
export function TinyEssentials({ title, essentials }: TinyEssentialsProps) {
  const [hero, ...rest] = essentials;
  const { rowsRef, drawn } = useRowsThatFit(rest);
  const mayInterrupt = essentials.some((e) => e.urgent !== undefined);
  // A lone figure named like the tile already has its caption in the heading.
  const heroNamedByTitle =
    hero !== undefined &&
    rest.length === 0 &&
    hero.label.toUpperCase() === title.toUpperCase();
  return (
    <Panel
      panelTitle={title}
      fitToSize
      hoverTitle
      sections={
        <Section full>
          <LiveRegion visuallyHidden>
            {spokenWords(essentials.filter((e) => e.urgent !== true))}
          </LiveRegion>
          {mayInterrupt && (
            <LiveRegion visuallyHidden assertive additionsOnly>
              {urgentWords(essentials).map((said) => (
                <Fragment key={said}>{`${said}. `}</Fragment>
              ))}
            </LiveRegion>
          )}
          {hero !== undefined && (
            <TinyEssentials__Hero data-tiny-essential="">
              {heroNamedByTitle ? (
                <VisuallyHidden as="dt">{hero.label}</VisuallyHidden>
              ) : (
                <TinyEssentials__Label>{hero.label}</TinyEssentials__Label>
              )}
              {hero.gauge === undefined ? (
                <TinyEssentials__HeroFigure $tone={hero.tone ?? "neutral"}>
                  <EssentialFigure essential={hero} />
                </TinyEssentials__HeroFigure>
              ) : (
                <TinyEssentials__GaugedFigure $tone={hero.tone ?? "neutral"}>
                  <TinyEssentials__FigureLine>
                    <EssentialFigure essential={hero} />
                  </TinyEssentials__FigureLine>
                  <CompactGauge essential={hero} gauge={hero.gauge} />
                </TinyEssentials__GaugedFigure>
              )}
            </TinyEssentials__Hero>
          )}
          {rest.length > 0 && (
            <TinyEssentials__Rows ref={rowsRef}>
              {rest.slice(0, drawn).map((essential) => (
                <TinyEssentials__Row
                  key={essential.label}
                  data-tiny-essential=""
                >
                  <TinyEssentials__Label>
                    {essential.label}
                  </TinyEssentials__Label>
                  <TinyEssentials__RowFigure
                    $tone={essential.tone ?? "neutral"}
                  >
                    <EssentialFigure essential={essential} />
                  </TinyEssentials__RowFigure>
                </TinyEssentials__Row>
              ))}
            </TinyEssentials__Rows>
          )}
        </Section>
      }
    />
  );
}

/**
 * How many of the rows are drawn: every one that fits the fit body's box under
 * the hero, in order. Starts from all of them whenever the box resizes or a
 * figure changes, and drops one per layout pass until the content fits, so a
 * tile that grows gets its rows back.
 */
function useRowsThatFit(rows: readonly TinyEssential[]) {
  const rowsRef = useRef<HTMLDListElement | null>(null);
  const [drawn, setDrawn] = useState(rows.length);
  const [pass, setPass] = useState(0);
  const figures = rows
    .map((row) => `${row.label}\u0000${row.word ?? figureKey(row.value)}`)
    .join("\u0001");

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new figure or a resized box starts the count again.
  useLayoutEffect(() => {
    setDrawn(rows.length);
  }, [figures, pass, rows.length]);

  useLayoutEffect(() => {
    const box = rowsRef.current?.closest("[data-panel-fit-body]");
    const content = box?.firstElementChild;
    if (!box || !content || drawn === 0) return;
    if (extentOf(content) > box.clientHeight) setDrawn(drawn - 1);
  });

  useLayoutEffect(() => {
    const box = rowsRef.current?.closest("[data-panel-fit-body]");
    if (!box || typeof ResizeObserver === "undefined") return;
    let seen = box.clientHeight;
    const observer = new ResizeObserver(() => {
      if (box.clientHeight === seen) return;
      seen = box.clientHeight;
      setPass((n) => n + 1);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  return { rowsRef, drawn };
}

/** Enough of a figure to tell when it changed, whatever shape it came in. */
function figureKey(value: TinyEssential["value"]): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

/** From the top of the content's first drawn child to the bottom of its last, descending into the section it is wrapped in. */
function extentOf(content: Element): number {
  const tops: number[] = [];
  const bottoms: number[] = [];
  for (const el of Array.from(
    content.querySelectorAll("[data-tiny-essential]"),
  )) {
    const r = el.getBoundingClientRect();
    tops.push(r.top);
    bottoms.push(r.bottom);
  }
  if (tops.length === 0) return 0;
  return Math.max(...bottoms) - Math.min(...tops);
}

function EssentialFigure({ essential }: { essential: TinyEssential }) {
  const { control } = essential;
  if (control !== undefined) {
    return (
      <ToggleButton
        size="sm"
        active={control.active}
        disabled={control.disabled}
        onClick={control.onPress}
        aria-label={control.title}
        title={control.hint ?? control.title}
      >
        {control.label}
      </ToggleButton>
    );
  }
  return (
    <>
      {essential.level !== undefined && (
        <LevelBars
          lit={essential.level.lit}
          of={essential.level.of}
          tone={essential.tone}
          label={essential.label}
        />
      )}
      {essential.word !== undefined ? (
        essential.word
      ) : (
        <Unit
          value={essential.value}
          decimals={essential.decimals}
          scale="compact"
        />
      )}
    </>
  );
}

/**
 * A thin bar under the hero figure: the scale's bands as a dim track, and a
 * fill over it from the foot of the scale to the value. The figure carries the
 * number, so the drawing is hidden from the accessibility tree. A held
 * reading dims the fill, as a held meter does; no value draws the bands
 * alone.
 */
function CompactGauge({
  essential,
  gauge,
}: {
  essential: TinyEssential;
  gauge: TinyGauge;
}) {
  const { shown, held } = resolveCurrency(essential.value);
  // Clamped in the algebra, so a bound on another rung of the same kind converts before it compares.
  const at = (q: Value): number =>
    fillFraction({
      amount: q.max(gauge.min).min(gauge.max).minus(gauge.min),
      capacity: gauge.max.minus(gauge.min),
    }) ?? 0;
  const share = shown == null ? null : at(shown);
  return (
    <TinyEssentials__Gauge
      aria-hidden="true"
      data-tiny-gauge=""
      data-held={held ? "" : undefined}
      viewBox="0 0 100 1"
      preserveAspectRatio="none"
    >
      {(gauge.bands ?? []).map((band) => (
        <rect
          key={`${at(band.from)}-${at(band.to)}`}
          x={at(band.from) * 100}
          y={0}
          width={(at(band.to) - at(band.from)) * 100}
          height={1}
          fill={TONE_MARK[band.tone]}
          opacity={0.35}
        />
      ))}
      {share !== null && (
        <rect
          data-tiny-gauge-fill=""
          x={0}
          y={0}
          width={share * 100}
          height={1}
          fill={TONE_MARK[essential.tone ?? "neutral"]}
          opacity={held ? 0.55 : 1}
        />
      )}
    </TinyEssentials__Gauge>
  );
}

/** Every state word on the tile with its label, the only thing the tile says aloud. */
function spokenWords(essentials: readonly TinyEssential[]): string {
  return essentials
    .filter((e) => e.word !== undefined)
    .map((e) => `${e.label} ${e.word}`)
    .join(", ");
}

/**
 * Each urgent word with its label, one text node apiece and no element, so the
 * region is as hidden as the polite one. The assertive region reads only what
 * is added to it, so a word is said when it turns urgent or changes while
 * urgent, and an unchanged one is not said again on the next render.
 */
function urgentWords(essentials: readonly TinyEssential[]): string[] {
  return essentials
    .filter((e) => e.urgent === true && e.word !== undefined)
    .map((e) => `${e.label} ${e.word}`);
}

/**
 * A registered widget's content at its current size: the kit's tiny form where
 * the widget declares one and the tile is tiny, its own component otherwise.
 * The grid, a test and a render harness all mount through this, so they agree
 * on what a tiny tile shows. The phone column does not: its tiles are the
 * phone's width whatever grid units it reports.
 *
 * @category TinyEssentials
 */
export function WidgetBody({
  def,
  ...props
}: ComponentProps & { def: ComponentDefinition }) {
  if (def.tiny !== undefined && showsTiny(def.tiny, props.w, props.h)) {
    return <TinyBody tiny={def.tiny} props={props} />;
  }
  const Widget = def.component;
  return <Widget {...props} />;
}

/**
 * Whether a widget with this tiny mode shows it in a `w` by `h` tile (in grid
 * units): true when the tile is narrower or shorter than the mode's
 * `bodyMinSize`, or {@link TINY_BELOW} when it sets none. False while either
 * dimension is unmeasured, so the widget's own body shows.
 *
 * @category TinyEssentials
 */
export function showsTiny(
  tiny: TinyMode,
  w: number | undefined,
  h: number | undefined,
): boolean {
  if (w === undefined || h === undefined) return false;
  const floor = tiny.bodyMinSize ?? TINY_BELOW;
  return w < floor.w || h < floor.h;
}

/**
 * The smallest tile, in grid units, in which a widget with this tiny mode
 * shows its own body rather than the tiny form: the mode's `bodyMinSize` (or
 * {@link TINY_BELOW}), raised to the widget's `minSize` where that is larger.
 *
 * @category TinyEssentials
 */
export function smallestBodyTile(
  tiny: TinyMode,
  minSize: { w: number; h: number } | undefined,
): { w: number; h: number } {
  const floor = tiny.bodyMinSize ?? TINY_BELOW;
  return {
    w: Math.max(floor.w, minSize?.w ?? 1),
    h: Math.max(floor.h, minSize?.h ?? 1),
  };
}

function TinyBody({ tiny, props }: { tiny: TinyMode; props: ComponentProps }) {
  const essentials = tiny.useEssentials(props);
  return <TinyEssentials title={tiny.title} essentials={essentials} />;
}

/* The label comes first for the reader and sits under the figure for the eye. */
const TinyEssentials__Hero = styled.dl`
  display: flex;
  flex-direction: column-reverse;
  align-items: center;
  gap: var(--gap-tiny-content);
  margin: 0;
  min-width: 0;
`;

const TinyEssentials__HeroFigure = styled.dd<{ $tone: Tone }>`
  display: inline-flex;
  align-items: baseline;
  gap: var(--gap-figure-parts);
  margin: 0;
  /* Sized against the tile, which the fit body makes a query container. */
  font-size: clamp(
    var(--font-size-lg),
    20cqw,
    calc(var(--font-size-lg) * 2)
  );
  font-weight: 700;
  line-height: var(--line-height-tight);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: ${({ $tone }) => TONE_TEXT[$tone]};
`;

/* Flush, so the figure and the bar under it fit the tile's content box, which is shorter than one tight figure line plus a gap. */
const TinyEssentials__GaugedFigure = styled(TinyEssentials__HeroFigure)`
  flex-direction: column;
  align-items: stretch;
  gap: var(--gap-caption);
  line-height: var(--line-height-flush);
`;

const TinyEssentials__FigureLine = styled.span`
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  gap: var(--gap-figure-parts);
`;

const TinyEssentials__Gauge = styled.svg`
  display: block;
  width: 100%;
  height: var(--size-tiny-gauge);
`;

const TinyEssentials__Label = styled.dt`
  font-size: var(--font-size-caption);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  white-space: nowrap;
`;

const TinyEssentials__Rows = styled.dl`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--gap-row-wrap);
  margin: 0;
  max-width: 100%;
`;

/* A row too wide for the tile drops its figure under its label rather than spilling past the edges. */
const TinyEssentials__Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: baseline;
  column-gap: var(--gap-label-value-tight);
  max-width: 100%;
`;

const TinyEssentials__RowFigure = styled.dd<{ $tone: Tone }>`
  display: inline-flex;
  align-items: baseline;
  gap: var(--gap-figure-parts);
  margin: 0;
  font-size: var(--font-size-value);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: ${({ $tone }) => TONE_TEXT[$tone]};
`;
