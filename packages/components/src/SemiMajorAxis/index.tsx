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
  type TinyEssential,
} from "@ksp-gonogo/sitrep-sdk";
import { EmptyState, Panel, Sparkline } from "@ksp-gonogo/ui";
import {
  NULL_DISPLAY,
  ReadoutCaption,
  Section,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { useBodyName } from "../shared/useBodyName";
import read from "./semi-major-axis.declarations.g";

const topics = defineTopicManifest({
  channels: ["vessel.orbit", "system.bodies"],
  optionalChannels: read.optionalChannels,
  fields: ["vessel.orbit.sma", "vessel.orbit.referenceBodyIndex"],
});

type SemiMajorAxisConfig = Record<string, never>;

const SPARK_WINDOW_SEC = 300;

/**
 * The semi-major axis as one figure. A hyperbolic orbit and a pulsating frame
 * each add a row, which a tile too short for it drops from the picture and
 * keeps for a screen reader.
 */
function useSemiMajorAxisEssentials(): readonly TinyEssential[] {
  // A propagated orbit conserves SMA, so a modelled figure would be the observed number dressed as fresh.
  const orbitReading = withoutReckoning(topics.useTelemetry("vessel.orbit"));
  const sma = stillTrue(orbitReading, undefined)?.sma;
  const controlFrame = stillTrue(
    useStream<ControlFrame>("system.frame"),
    undefined,
  );
  return [
    {
      label: "SMA",
      value: readingOf(orbitReading, (orbit) => orbit.sma),
    },
    ...(sma?.isNegative() ? [{ label: "Orbit", word: "HYPERBOLIC" }] : []),
    ...(lengthsAreLengths(controlFrame) === "invalid"
      ? [
          {
            label: "Frame",
            word: controlFrameLabel(controlFrame) ?? "pulsating frame",
          },
        ]
      : []),
  ];
}

function SemiMajorAxisComponent({
  w,
  h,
}: Readonly<ComponentProps<SemiMajorAxisConfig>>) {
  // A propagated orbit conserves SMA, so a modelled figure would be the observed number dressed as fresh.
  const orbitReading = withoutReckoning(topics.useTelemetry("vessel.orbit"));
  const sma = stillTrue(orbitReading, undefined)?.sma;
  const smaHeld = orbitReading.state === "held";
  const frameReading = useStream<ControlFrame>("system.frame");
  // The selected frame is a setting, which a quiet link does not change.
  const controlFrame = stillTrue(frameReading, undefined);
  const lengthsPulsate = lengthsAreLengths(controlFrame) === "invalid";
  const referenceBody = useBodyName(
    stillTrue(orbitReading, undefined)?.referenceBodyIndex,
  );
  const series = useDataSeries("vessel.orbit.sma", SPARK_WINDOW_SEC);
  const sparkValues = series.v.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  const cols = w ?? 4;
  const rows = h ?? 4;
  const showSubtitle = rows >= 5 && cols >= 4;

  const fontPx = readoutFontPx(cols);

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
      panelTrend={({ w, h }) => (
        <Sparkline
          values={sparkValues}
          width={w}
          height={h}
          aria-label="SMA trend"
        />
      )}
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
          {/* An unbound orbit has a negative semi-major axis, which reads as an error without its name. */}
          {sma.isNegative() && (
            <ReadoutCaption style={SMA_CAPTION_STYLE}>
              Hyperbolic
            </ReadoutCaption>
          )}
          {/* A pulsating frame's length unit moves with its pair, so the frame is named. */}
          {lengthsPulsate && (
            <ReadoutCaption role="status" style={SMA_CAPTION_STYLE}>
              {controlFrameLabel(controlFrame) ?? "pulsating frame"}
            </ReadoutCaption>
          )}
        </Section>
      }
    />
  );
}

// Font scales with width so the value never wraps into the subtitle.
function readoutFontPx(cols: number): number {
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

registerComponent<SemiMajorAxisConfig>({
  id: "semi-major-axis",
  name: "Semi-major axis",
  description:
    "The semi-major axis of your current orbit: half the longest width of the orbit's ellipse, measured through the ellipse's centre, not the body's, since the body sits at one focus. It sets the orbital period, which the Kepler Period widget plots. In a pulsating reference frame, whose unit of length moves with a pair of bodies, the frame is named beneath the figure.",
  tags: ["telemetry", "orbit"],
  defaultSize: { w: 4, h: 4 },
  // Below four columns or four rows the figure shares the tile with a heading it has no room for, and the tile draws the figure alone.
  minSize: { w: 4, h: 4 },
  component: SemiMajorAxisComponent,
  tiny: { title: "SMA", useEssentials: useSemiMajorAxisEssentials },
  channels: topics.channels,
  ...read,
  fields: topics.fields,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { SemiMajorAxisComponent };
