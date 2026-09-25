import type { ComponentProps } from "@ksp-gonogo/core";
import { defineTopicManifest, registerComponent } from "@ksp-gonogo/core";

const topics = defineTopicManifest({
  channels: ["vessel.orbit", "system.bodies"],
  fields: ["vessel.orbit.sma", "vessel.orbit.referenceBodyIndex"],
});

import { useDataSeries } from "@ksp-gonogo/data";
import {
  observedAt,
  readingOf,
  useStream,
  useViewUt,
  withoutReckoning,
} from "@ksp-gonogo/sitrep-client";
import {
  type ControlFrame,
  controlFrameLabel,
  lengthsAreLengths,
  stillTrue,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { EmptyState, Panel, Sparkline } from "@ksp-gonogo/ui";
import { ReadoutCaption, Section, Unit } from "@ksp-gonogo/ui-kit";
import { useCallback, useRef, useState } from "react";
import { useBodyName } from "../shared/useBodyName";

type SemiMajorAxisConfig = Record<string, never>;

const SPARK_WINDOW_SEC = 300;

function SemiMajorAxisComponent({
  w,
  h,
}: Readonly<ComponentProps<SemiMajorAxisConfig>>) {
  /**
   * SMA is a scalar readout beside a label, so it DATES rather than blanks.
   * Withholding a stale value is for the widgets that turn one into a verdict;
   * a number an operator reads as "2.87 Mm, at last contact 14s ago" is still a
   * useful, honest thing to draw, and blanking it would lose the one figure
   * this tile exists to show.
   *
   * `withoutReckoning` first, deliberately: it puts `reckoned` out of reach so
   * no later edit can quietly draw a modelled figure here. A propagated orbit
   * conserves SMA exactly, so a reckoned figure would be the same number dressed
   * as fresh evidence, and it would also disagree in kind with the sparkline
   * beside it, which is observed history and cannot be modelled forward. So this
   * widget declines the model and says how old the observation is instead. The
   * caption fires off `state` alone, which the decline leaves exactly as it was.
   */
  const orbitReading = withoutReckoning(topics.useTelemetry("vessel.orbit"));
  const sma = stillTrue(orbitReading, undefined)?.sma;
  // Held rather than never-seen: only `stale` reads as "the link went quiet",
  // and a cold start must not accuse it.
  const smaHeld = orbitReading.state === "stale";
  const frameReading = useStream<ControlFrame>("system.frame");
  // The selected frame is a setting, which a quiet link does not change.
  const controlFrame =
    frameReading.state === "observed" || frameReading.state === "stale"
      ? frameReading.value
      : undefined;
  const lengthsPulsate = lengthsAreLengths(controlFrame) === "invalid";
  // Age of the observation against the FRAME's view time, never a wall clock:
  // two reads in one frame must not disagree about how old the same sample is.
  const viewUt = useViewUt();
  // The age, spelled out now that `readingAge` is gone: an instant minus an instant
  // is a duration, and the affine rules make that the type. The clamp came with it
  // and stays, because samples arrive out of order (`ClientTimeline` insert-sorts
  // for it) so one can sit marginally ahead of the frame and "-0.4 s ago" is never
  // a thing to render.
  const smaObservedUt = observedAt(orbitReading);
  const smaAgeSec =
    viewUt && smaObservedUt
      ? Math.max(0, viewUt.minus(smaObservedUt).magnitude)
      : undefined;
  const referenceBody = useBodyName(
    stillTrue(orbitReading, undefined)?.referenceBodyIndex,
  );
  // `useDataSeries` (sparkline history) carries the same stream shim, `o.sma`
  // maps to the raw `vessel.orbit.sma` field-subtopic, so once `vessel.orbit`
  // is carried this sparkline reads its window straight off the
  // `TimelineStore`'s buffered history, same as the headline `sma` value
  // above. See `stream.test.tsx` for the end-to-end proof.
  const series = useDataSeries("data", "vessel.orbit.sma", SPARK_WINDOW_SEC);
  const sparkValues = series.v as number[];
  // Connectivity indicator keyed off the headline `o.sma` -> `vessel.orbit.sma`.

  const cols = w ?? 4;
  const rows = h ?? 4;
  // Subtitle is "what is this widget" elaboration, suppress when there's
  // no room without crowding the readout. At default 4×4 the panel title
  // ("SMA") + value already cover the operator's read-at-a-glance need.
  const showSubtitle = rows >= 5 && cols >= 4;
  /* A 3x3 body has room for the figure and nothing under it, so the age gives
     way there and the figure's own held mark is what says the link went quiet. */
  const showHeldCaption = smaHeld && rows >= 4;
  /* At four rows the body holds the figure and one thing under it. While held
     that is the age, since a trend that has stopped arriving says less than how
     long ago it stopped. */
  const showSparkline =
    rows >= 4 && cols >= 3 && !(showHeldCaption && rows < 5);

  // SmaDisplay font scales with available width so the value (e.g.
  // "2.87 Mm", "680.0 km") doesn't wrap onto two lines at narrow column
  // counts. Wrap was the underlying cause of the readout overlapping the
  // subtitle on small widgets: keep it on one line and the layout
  // resolves itself.
  const readoutFontPx = cols <= 3 ? 18 : cols <= 4 ? 22 : 28;

  // Sparkline width tracks its slot. The Sparkline renders a fixed-width
  // SVG (no intrinsic responsiveness), so we measure the slot and feed it
  // an explicit pixel width. The measurement lives on a *callback ref*
  // rather than a `[]`-deps effect: the sparkline only mounts once orbit
  // data arrives (before that the widget shows the EmptyState branch and
  // SparkSlot is absent from the tree). A mount-time effect would run
  // against a null ref and never re-attach when the slot later appears,
  // leaving the width pinned at its 120-px default. The callback ref fires
  // exactly when the node attaches/detaches.
  const roRef = useRef<ResizeObserver | null>(null);
  const [sparkWidth, setSparkWidth] = useState(120);
  const sparkRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const measure = (width: number) => {
      if (width > 0) {
        setSparkWidth((prev) => {
          const next = Math.max(40, Math.floor(width));
          return prev === next ? prev : next;
        });
      }
    };
    measure(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      measure(entries[0].contentRect.width);
    });
    ro.observe(el);
    roRef.current = ro;
  }, []);

  if (sma === undefined || !sma.isFinite()) {
    return (
      <Panel
        panelTitle="SMA"
        sections={
          <Section full>
            <EmptyState>No orbit data</EmptyState>
          </Section>
        }
      />
    );
  }

  return (
    <Panel
      panelTitle="SMA"
      /* Panel's own centring, where `Body` hand-rolled the `flex: 1` +
         `justify-content: center` pair. A single headline readout sized to the
         tile is what `fitToSize` is for, and Panel measures before it centres
         so an overflowing readout still starts at the top. */
      fitToSize
      sections={
        <Section full gap="sm">
          {showSubtitle && (
            <ReadoutCaption style={SMA_CAPTION_STYLE}>
              Semi-major axis{referenceBody ? ` · ${referenceBody}` : ""}
            </ReadoutCaption>
          )}
          <div
            style={{
              ...SMA_DISPLAY_STYLE,
              fontSize: `${readoutFontPx}px`,
              // Muted while held: the tone carries the caveat at a glance, the
              // caption below says it in words.
              ...(smaHeld ? { color: "var(--color-text-muted)" } : {}),
            }}
          >
            {/* The whole reading rather than the bare value, so the number
                itself carries whether it is current: the superscript dot for a
                sighted reader, the grade's own word for a listening one. The
                muted tone above and the caption below are the widget's own
                additions to that, not the only thing saying it. */}
            <Unit value={readingOf(orbitReading, (orbit) => orbit.sma)} />
          </div>
          {/* The caveat belongs on the value rather than in the panel chrome: a
            header badge beside a confident-looking number is the thing an
            operator reads past. */}
          {showHeldCaption && (
            <ReadoutCaption style={SMA_CAPTION_STYLE}>
              <span role="status">at last contact</span>
              {/* Game-time seconds: the age is one UT minus another, so it
                  belongs on the "s" ladder and not the real-time one. */}
              {smaAgeSec !== undefined && (
                <>
                  {", "}
                  <Unit value={value("s", smaAgeSec)} />
                  {" ago"}
                </>
              )}
            </ReadoutCaption>
          )}
          {/* The frame's name. A pulsating frame's length unit is its pair's own
            separation, so a length quoted in it moves with the pair; naming the
            frame is what says which units these are. LABELLED rather than
            suppressed, unlike an apsis: an apsis in such a frame does not exist
            at all, where a semi-major axis does. */}
          {lengthsPulsate && (
            <ReadoutCaption role="status">
              {controlFrameLabel(controlFrame) ?? "pulsating frame"}
            </ReadoutCaption>
          )}
          {showSparkline && (
            <div ref={sparkRef} style={SPARK_SLOT_STYLE}>
              <Sparkline
                values={sparkValues}
                width={sparkWidth}
                height={28}
                ariaLabel="SMA trend"
              />
            </div>
          )}
        </Section>
      }
    />
  );
}

/** Centres the kit's caption on the reading it belongs to. */
const SMA_CAPTION_STYLE = { textAlign: "center" } as const;

/**
 * The reading itself. Display tier, so it is off the type scale, and the size
 * here is only a floor: the widget measures its own width and writes a
 * `readoutFontPx` over it every render, which is why this cannot be a rung.
 */
const SMA_DISPLAY_STYLE = {
  fontSize: "28px",
  letterSpacing: "0.04em",
  color: "var(--color-text-primary)",
  textAlign: "center",
  whiteSpace: "nowrap",
} as const;

/**
 * Reserves the sparkline's height before it measures, so the rows below it do
 * not jump on the first paint.
 *
 * `contain: inline-size` keeps the sparkline out of the column's width. The
 * sparkline is drawn at whatever width its slot measured, so without it the
 * column is sized by the sparkline's starting width, which is wider than a
 * three-column tile, the slot then measures that same width back, and the
 * centred rows spill past both edges of the cell.
 */
const SPARK_SLOT_STYLE = {
  width: "100%",
  height: "28px",
  contain: "inline-size",
} as const;

registerComponent<SemiMajorAxisConfig>({
  id: "semi-major-axis",
  name: "Semi-major axis",
  description:
    "Semi-major axis of the current orbit (distance from the body centre, averaged across the ellipse). Determines orbital period and total energy.",
  tags: ["telemetry", "orbit"],
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 3, h: 3 },
  component: SemiMajorAxisComponent,
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { SemiMajorAxisComponent };
