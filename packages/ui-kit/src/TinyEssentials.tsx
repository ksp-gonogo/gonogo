import type {
  ComponentDefinition,
  ComponentProps,
  TinyEssential,
  TinyMode,
} from "@ksp-gonogo/sitrep-sdk";
import styled from "styled-components";
import { LevelBars } from "./LevelBars";
import { Panel } from "./Panel";
import { Section } from "./Section";
import { STAT_TONE_COLOR, type StatTone } from "./statTone";
import { Unit } from "./Unit";
import { VisuallyHidden } from "./VisuallyHidden";
import { TINY_BELOW } from "./widgetSize";

/**
 * Props for {@link TinyEssentials}: a widget's tiny heading and its essentials.
 *
 * @category Tiny mode
 */
export interface TinyEssentialsProps {
  title: string;
  essentials: readonly TinyEssential[];
}

/**
 * The one form every widget with a tiny mode takes at the tiny size: its short
 * heading over its essential values, the first drawn large and the rest as
 * label and figure rows under it.
 *
 * @category Tiny mode
 */
export function TinyEssentials({ title, essentials }: TinyEssentialsProps) {
  const [hero, ...rest] = essentials;
  // A lone figure named like the tile already has its caption in the heading.
  const heroNamedByTitle =
    hero !== undefined &&
    rest.length === 0 &&
    hero.label.toUpperCase() === title.toUpperCase();
  return (
    <Panel
      panelTitle={title}
      fitToSize
      sections={
        <Section full>
          {hero !== undefined && (
            <TinyEssentials__Hero data-tiny-essential="">
              {heroNamedByTitle ? (
                <VisuallyHidden as="dt">{hero.label}</VisuallyHidden>
              ) : (
                <TinyEssentials__Label>{hero.label}</TinyEssentials__Label>
              )}
              <TinyEssentials__HeroFigure $tone={hero.tone ?? "neutral"}>
                <EssentialFigure essential={hero} />
              </TinyEssentials__HeroFigure>
            </TinyEssentials__Hero>
          )}
          {rest.length > 0 && (
            <TinyEssentials__Rows>
              {rest.map((essential) => (
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

function EssentialFigure({ essential }: { essential: TinyEssential }) {
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
      <Unit value={essential.value} decimals={essential.decimals} />
    </>
  );
}

/**
 * A registered widget's content at its current size: the kit's tiny form where
 * the widget declares one and the tile is tiny, its own component otherwise.
 * The grid, a test and a render harness all mount through this, so they agree
 * on what a tiny tile shows. The phone column does not: its tiles are the
 * phone's width whatever grid units it reports.
 *
 * @category Tiny mode
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
 * Whether a widget with this tiny mode shows it in a `w` by `h` tile. Unmeasured dims show the body.
 *
 * @category Tiny mode
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
 * The smallest tile that shows this tiny mode's widget its own body, never below `minSize`.
 *
 * @category Tiny mode
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

const TinyEssentials__HeroFigure = styled.dd<{ $tone: StatTone }>`
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
  ${({ $tone }) => STAT_TONE_COLOR[$tone]}
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

const TinyEssentials__RowFigure = styled.dd<{ $tone: StatTone }>`
  display: inline-flex;
  align-items: baseline;
  gap: var(--gap-figure-parts);
  margin: 0;
  font-size: var(--font-size-value);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  ${({ $tone }) => STAT_TONE_COLOR[$tone]}
`;
