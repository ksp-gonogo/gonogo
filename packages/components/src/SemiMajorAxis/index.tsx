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
   * A scalar beside a label dates rather than blanks when stale.
   * `withoutReckoning` because a propagated orbit conserves SMA, so a
   * modelled figure would be the same number dressed as fresh, and would
   * disagree in kind with the observed sparkline beside it.
   */
  const orbitReading = withoutReckoning(topics.useTelemetry("vessel.orbit"));
  const sma = stillTrue(orbitReading, undefined)?.sma;
  // Held rather than never-seen: only `stale` reads as "the link went quiet", and a cold start must not accuse it.
  const smaHeld = orbitReading.state === "stale";
  const frameReading = useStream<ControlFrame>("system.frame");
  // The selected frame is a setting, which a quiet link does not change.
  const controlFrame =
    frameReading.state === "observed" || frameReading.state === "stale"
      ? frameReading.value
      : undefined;
  const lengthsPulsate = lengthsAreLengths(controlFrame) === "invalid";
  // Age against the frame's view time, never a wall clock, so two reads in one frame agree.
  const viewUt = useViewUt();
  // Clamped because samples arrive out of order, and "-0.4 s ago" is never a thing to render.
  const smaObservedUt = observedAt(orbitReading);
  const smaAgeSec =
    viewUt && smaObservedUt
      ? Math.max(0, viewUt.minus(smaObservedUt).magnitude)
      : undefined;
  const referenceBody = useBodyName(
    stillTrue(orbitReading, undefined)?.referenceBodyIndex,
  );
  // The sparkline reads its window off the `TimelineStore`'s buffered history once `vessel.orbit` is carried.
  const series = useDataSeries("data", "vessel.orbit.sma", SPARK_WINDOW_SEC);
  const sparkValues = series.v as number[];
  const cols = w ?? 4;
  const rows = h ?? 4;
  // The subtitle is elaboration, dropped when there is no room.
  const showSubtitle = rows >= 5 && cols >= 4;
  /* At 3x3 the age gives way and the figure's own held mark says the link went quiet. */
  const showHeldCaption = smaHeld && rows >= 4;
  /* At four rows, while held, the age wins the one slot under the figure over a trend that stopped arriving. */
  const showSparkline =
    rows >= 4 && cols >= 3 && !(showHeldCaption && rows < 5);

  // Font scales with width so the value never wraps into the subtitle.
  const readoutFontPx = cols <= 3 ? 18 : cols <= 4 ? 22 : 28;

  // The Sparkline is fixed-width SVG, so its slot is measured. A callback ref, since the slot only mounts once orbit data arrives.
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
      fitToSize
      sections={
        <Section full gap="related-dense">
          {showSubtitle && (
            <ReadoutCaption style={SMA_CAPTION_STYLE}>
              Semi-major axis{referenceBody ? ` · ${referenceBody}` : ""}
            </ReadoutCaption>
          )}
          <div
            style={{
              ...SMA_DISPLAY_STYLE,
              fontSize: `${readoutFontPx}px`,
              // Muted while held; the caption below says it in words.
              ...(smaHeld ? { color: "var(--color-text-muted)" } : {}),
            }}
          >
            {/* The whole reading, so the number itself carries whether it is current. */}
            <Unit value={readingOf(orbitReading, (orbit) => orbit.sma)} />
          </div>
          {/* The caveat sits on the value: a header badge beside a confident number is what an operator reads past. */}
          {showHeldCaption && (
            <ReadoutCaption style={SMA_CAPTION_STYLE}>
              <span role="status">at last contact</span>
              {/* Game-time seconds, so the "s" ladder rather than the real-time one. */}
              {smaAgeSec !== undefined && (
                <>
                  {", "}
                  <Unit value={value("s", smaAgeSec)} />
                  {" ago"}
                </>
              )}
            </ReadoutCaption>
          )}
          {/* A pulsating frame's length unit moves with its pair, so the frame is named. Labelled rather than suppressed: a semi-major axis exists in such a frame, where an apsis does not. */}
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

/** Display tier, off the type scale. Only a floor: the widget writes a measured `readoutFontPx` over it. */
const SMA_DISPLAY_STYLE = {
  fontSize: "28px",
  letterSpacing: "0.04em",
  color: "var(--color-text-primary)",
  textAlign: "center",
  whiteSpace: "nowrap",
} as const;

/**
 * Reserves the sparkline's height before it measures. `contain: inline-size`
 * keeps the sparkline's starting width from sizing the column, which would
 * spill a three-column tile.
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
