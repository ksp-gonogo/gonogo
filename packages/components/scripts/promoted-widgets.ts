/**
 * The PROMOTED-widgets manifest: the curated set of widgets whose release/docs
 * assets (an animated GIF and/or static stills) are kept fresh by the
 * `render-promoted-assets` pipeline and committed to `docs/assets/` by CI
 * (`.github/workflows/refresh-promoted-assets.yml`), so README / release /
 * marketing assets never go stale.
 *
 * Promoting a widget is a one-entry change here: add a `PromotedWidget` with a
 * `gif` (an animation driver) and/or `stills` (static renders). The render
 * script is scenario-agnostic, each entry plugs in its OWN frame source, so
 * this file is the only place widget-specific knowledge lives.
 *
 * Landing is the first (and, for now, only) promoted widget: its ~15s Mun
 * descent GIF plus a couple of key descent stills for the first public release
 * post. transfer-window etc. are future entries.
 */
import {
  type Frame,
  integrate,
  streamFixture,
} from "./synthesize-landing-descent";

/** A static still render for a promoted widget. */
export interface PromotedStill {
  /** Output basename under `docs/assets/` (no extension), e.g. `landing-final`. */
  name: string;
  /**
   * A committed render fixture, path relative to `packages/components/src/`
   * (e.g. `LandingStatus/__render__/descent-final.json`). The script renders
   * this single fixture full-height; reusing the curated `__render__` fixtures
   * keeps the stills in lock-step with the ones the widget author maintains.
   */
  fixtureFile: string;
  /** Tile size (grid units): width is honoured; height grows to fit (fullContent). */
  w: number;
  h: number;
}

/** The animated GIF for a promoted widget. */
export interface PromotedGif {
  /** Output basename under `docs/assets/` (no extension), e.g. `landing-descent`. */
  name: string;
  /** Target playback length; the per-frame delay is derived from the frame count. */
  targetSeconds: number;
  /** Tile size (grid units): width fixed, height grows per frame (fullContent). */
  w: number;
  h: number;
  /**
   * Ordered animation frames, each a `_stream` render-fixture object. Each
   * promoted widget supplies its own scenario driver; the render script only
   * renders each frame full-height and stitches, it knows nothing widget- or
   * scenario-specific.
   */
  frames: () => Array<Record<string, unknown>>;
}

export interface PromotedWidget {
  /** Registered widget id (matches `registerComponent({ id })`). */
  widgetId: string;
  gif?: PromotedGif;
  stills?: PromotedStill[];
}

// ── Landing GIF frame sampler (was render-landing-gif's local sampleFrames) ──
const LANDING_GIF_FRAMES = 48;
// A delayed regime so the commit clocks are live in-frame.
const LANDING_GIF_ONE_WAY_S = 2;

/**
 * Sample the descent to ~`target` frames evenly in ALTITUDE (not time). A Mun
 * descent spends its first two-thirds dropping fast and its last third crawling
 * the final hundreds of metres; sampling evenly in time would waste most frames
 * on the slow tail. Even-in-altitude gives a constant visual descent rate.
 * Frames are monotonic-decreasing in agl, so each altitude rung maps to its
 * nearest frame (deduped).
 */
function sampleByAltitude(frames: Frame[], target: number): Frame[] {
  if (frames.length <= target) return frames;
  const maxAgl = frames[0].aglMeters;
  const out: Frame[] = [];
  let prevIdx = -1;
  for (let i = 0; i < target; i++) {
    const targetAgl = maxAgl * (1 - i / (target - 1));
    let best = 0;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (let j = 0; j < frames.length; j++) {
      const delta = Math.abs(frames[j].aglMeters - targetAgl);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = j;
      }
    }
    if (best !== prevIdx) {
      out.push(frames[best]);
      prevIdx = best;
    }
  }
  return out;
}

export const PROMOTED_WIDGETS: readonly PromotedWidget[] = [
  {
    widgetId: "landing-status",
    gif: {
      name: "landing-descent",
      targetSeconds: 15,
      w: 12,
      h: 20,
      frames: () =>
        sampleByAltitude(integrate(), LANDING_GIF_FRAMES).map((f, i) =>
          streamFixture(
            f,
            LANDING_GIF_ONE_WAY_S,
            `descent-gif-${i}`,
            "GIF frame (synthetic descent).",
          ),
        ),
    },
    stills: [
      // Suicide-burn ignition: committed, still fast (DIVERT), hot band lit.
      {
        name: "landing-ignition",
        fixtureFile: "LandingStatus/__render__/descent-ignition.json",
        w: 12,
        h: 20,
      },
      // Final approach: soft descent, gear down, site reads SAFE.
      {
        name: "landing-final",
        fixtureFile: "LandingStatus/__render__/descent-final.json",
        w: 12,
        h: 20,
      },
    ],
  },
];
