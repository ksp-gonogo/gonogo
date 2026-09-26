import type { ComponentProps } from "@ksp-gonogo/core";
import { defineTopicManifest, registerComponent } from "@ksp-gonogo/core";

import { useDataSeries } from "@ksp-gonogo/data";
import {
  readingOf,
  useStream,
  withoutReckoning,
} from "@ksp-gonogo/sitrep-client";
import {
  type ControlFrame,
  controlFrameLabel,
  lengthsAreLengths,
  stillTrue,
} from "@ksp-gonogo/sitrep-sdk";
import { EmptyState, Panel, Sparkline } from "@ksp-gonogo/ui";
import {
  NULL_DISPLAY,
  ReadoutCaption,
  Section,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { useCallback, useRef, useState } from "react";
import { useBodyName } from "../shared/useBodyName";

const topics = defineTopicManifest({
  channels: ["vessel.orbit", "system.bodies"],
  fields: ["vessel.orbit.sma", "vessel.orbit.referenceBodyIndex"],
});

type SemiMajorAxisConfig = Record<string, never>;

const SPARK_WINDOW_SEC = 300;

function SemiMajorAxisComponent({
  w,
  h,
}: Readonly<ComponentProps<SemiMajorAxisConfig>>) {
  // A propagated orbit conserves SMA, so a modelled figure would be the observed number dressed as fresh.
  const orbitReading = withoutReckoning(topics.useTelemetry("vessel.orbit"));
  const sma = stillTrue(orbitReading, undefined)?.sma;
  const smaHeld = orbitReading.state === "stale";
  const frameReading = useStream<ControlFrame>("system.frame");
  // The selected frame is a setting, which a quiet link does not change.
  const controlFrame = stillTrue(frameReading, undefined);
  const lengthsPulsate = lengthsAreLengths(controlFrame) === "invalid";
  const referenceBody = useBodyName(
    stillTrue(orbitReading, undefined)?.referenceBodyIndex,
  );
  const series = useDataSeries("data", "vessel.orbit.sma", SPARK_WINDOW_SEC);
  const sparkValues = series.v as number[];
  const cols = w ?? 4;
  const rows = h ?? 4;
  const showSubtitle = rows >= 5 && cols >= 4;
  const showSparkline = rows >= 4 && cols >= 3;

  const fontPx = readoutFontPx(cols);

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
              Semi-major axis{bodySuffix(referenceBody)}
            </ReadoutCaption>
          )}
          <div
            style={{
              ...SMA_DISPLAY_STYLE,
              fontSize: `${fontPx}px`,
              // Muted while held; the Unit's own mark carries the time it was read.
              ...(smaHeld ? { color: "var(--color-text-muted)" } : {}),
            }}
          >
            <Unit value={readingOf(orbitReading, (orbit) => orbit.sma)} />
          </div>
          {/* A pulsating frame's length unit moves with its pair, so the frame is named. */}
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

// Font scales with width so the value never wraps into the subtitle.
function readoutFontPx(cols: number): number {
  if (cols <= 3) return 18;
  if (cols <= 4) return 22;
  return 28;
}

/** Bare while the body table is loading, the null glyph once it is a confirmed tombstone. */
function bodySuffix(name: string | null | undefined): string {
  if (name === null) return ` · ${NULL_DISPLAY}`;
  if (!name) return "";
  return ` · ${name}`;
}

/** Centres the kit's caption on the reading it belongs to. */
const SMA_CAPTION_STYLE = { textAlign: "center" } as const;

/** Display tier, off the type scale. Only a floor: the widget writes `readoutFontPx` over it. */
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
