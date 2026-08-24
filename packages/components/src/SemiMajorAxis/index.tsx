import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent, useTelemetry } from "@ksp-gonogo/core";
import { useDataSeries } from "@ksp-gonogo/data";
import {
  observedAt,
  type Reading,
  useStream,
  useViewUt,
  type VesselState,
  withoutReckoning,
} from "@ksp-gonogo/sitrep-client";
import {
  type ControlFrame,
  controlFrameLabel,
  lengthsAreLengths,
} from "@ksp-gonogo/sitrep-sdk";
import { EmptyState, Panel, Sparkline } from "@ksp-gonogo/ui";
import { formatDuration, ReadoutCaption, Unit } from "@ksp-gonogo/ui-kit";
import { useCallback, useRef, useState } from "react";
import styled from "styled-components";

type SemiMajorAxisConfig = Record<string, never>;

const SPARK_WINDOW_SEC = 300;

/** Whether a reading went stale, as opposed to never having arrived. */
function notCurrent<T>(reading: Reading<T>): boolean {
  return reading.state === "stale";
}

/**
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
function stillTrue<T, A>(
  reading: Reading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "reckonable") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

function SemiMajorAxisComponent({
  w,
  h,
}: Readonly<ComponentProps<SemiMajorAxisConfig>>) {
  // Both reads ride the Uplink stream directly, no legacy `useTelemetry("data",
  // ...)` fallback:
  //  - `sma` is the raw `vessel.orbit.sma` element, read off the canonical
  //    whole-`vessel.orbit` Topic.
  //  - `referenceBody` is the SDK-derived `vessel.state.referenceBodyName`
  //    display map (the client resolves `vessel.orbit.referenceBodyIndex`
  //    against `system.bodies`, see `vessel-state.ts`). It isn't a wire
  //    `TopicId`, so it reads through `useStream`.
  /**
   * SMA is a scalar readout beside a label, so it DATES rather than blanks.
   * `judgeable` is for the widgets that turn a value into a verdict; a number an
   * operator reads as "2.87 Mm, at last contact 14s ago" is still a useful,
   * honest thing to draw, and blanking it would lose the one figure this tile
   * exists to show.
   *
   * `withoutReckoning` first, deliberately: it is what makes the caption fire on
   * a modelled reading too. A propagated orbit conserves SMA exactly, so a
   * reckoned figure here would be the same number dressed as fresh evidence,
   * and it would also disagree in kind with the sparkline beside it, which is
   * observed history and cannot be modelled forward. So this widget declines the
   * model and says how old the observation is instead.
   */
  const orbitReading = withoutReckoning(useTelemetry("vessel.orbit"));
  const sma = stillTrue(orbitReading, undefined)?.sma;
  // Held rather than never-seen: only `stale` reads as "the link went quiet",
  // and a cold start must not accuse it.
  const smaHeld = notCurrent(orbitReading);
  const controlFrame = useStream<ControlFrame>("system.frame");
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
  const referenceBody =
    useStream<VesselState>("vessel.state")?.referenceBodyName ?? undefined;
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
  const showSparkline = rows >= 4 && cols >= 3;

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
      <Panel panelTitle="SMA">
        <EmptyState>No orbit data</EmptyState>
      </Panel>
    );
  }

  return (
    <Panel panelTitle="SMA">
      <Body>
        {showSubtitle && (
          <SmaCaption>
            Semi-major axis{referenceBody ? ` · ${referenceBody}` : ""}
          </SmaCaption>
        )}
        <SmaDisplay
          role="status"
          aria-live="polite"
          style={{
            fontSize: `${readoutFontPx}px`,
            // Muted while held: the tone carries the caveat at a glance, the
            // caption below says it in words.
            ...(smaHeld ? { color: "var(--color-text-muted)" } : {}),
          }}
        >
          <Unit value={sma} />
        </SmaDisplay>
        {/* The caveat belongs on the value rather than in the panel chrome: a
            header badge beside a confident-looking number is the thing an
            operator reads past. */}
        {smaHeld && (
          <ReadoutCaption role="status">
            at last contact
            {smaAgeSec !== undefined && `, ${formatDuration(smaAgeSec)} ago`}
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
          <SparkSlot ref={sparkRef}>
            <Sparkline
              values={sparkValues}
              width={sparkWidth}
              height={28}
              ariaLabel="SMA trend"
            />
          </SparkSlot>
        )}
      </Body>
    </Panel>
  );
}

const Body = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  gap: var(--space-6);
  min-height: 0;
`;

const SmaCaption = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  letter-spacing: 0.04em;
  text-align: center;
`;

const SmaDisplay = styled.div`
  /* Off the type scale: display tier (the scale stops at 16px), and in any
     case overridden at runtime by the inline readoutFontPx style. */
  font-size: 28px;
  letter-spacing: 0.04em;
  color: var(--color-text-primary);
  text-align: center;
  white-space: nowrap;
`;

const SparkSlot = styled.div`
  width: 100%;
  height: 28px;
`;

registerComponent<SemiMajorAxisConfig>({
  id: "semi-major-axis",
  name: "Semi-major axis",
  description:
    "Semi-major axis of the current orbit (distance from the body centre, averaged across the ellipse). Determines orbital period and total energy.",
  tags: ["telemetry", "orbit"],
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 3, h: 3 },
  component: SemiMajorAxisComponent,
  dataRequirements: ["vessel.orbit.sma", "vessel.state.referenceBodyName"],
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { SemiMajorAxisComponent };
