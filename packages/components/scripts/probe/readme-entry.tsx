/**
 * Stage entry for the README pictures: mounts several widgets on one page at
 * absolute grid positions, then steps every playback track to the same frame.
 *
 * All instances live in one page on one pinned clock, so a frame is a single
 * instant for the whole stage and one screenshot captures all of it.
 */
import type { PlaybackEmit } from "../playbackFrame";
import { probePayload } from "./payload";
import { mountProbe, type ProbeMount } from "./probe-entry";

/** One widget placed on the stage, in pixels from the stage's top-left. */
export interface StageCell {
  widgetId: string;
  fixture: Record<string, unknown>;
  /** Grid footprint the widget lays out for. */
  w: number;
  h: number;
  x: number;
  y: number;
  config?: Record<string, unknown>;
  /** The playback track whose frames drive this widget. */
  track?: string;
}

export interface StageFrame {
  ut: number;
  emits: PlaybackEmit[];
}

export interface StageSpec {
  width: number;
  height: number;
  cells: StageCell[];
  tracks: Record<string, StageFrame[]>;
  /** How far into each track a still of this stage is taken, from 0 to 1. */
  stillAt?: Record<string, number>;
}

declare global {
  interface Window {
    __stage: {
      mount: (spec: StageSpec) => Promise<void>;
      /** Moves every track to the frame index given for it and waits for the paint. */
      step: (indices: Record<string, number>) => Promise<void>;
    };
  }
}

const mounts: Array<{ mount: ProbeMount; track?: string }> = [];
let tracks: StageSpec["tracks"] = {};

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

window.__stage = {
  async mount(spec) {
    const root = document.getElementById("root");
    if (!root) throw new Error("Stage: #root element missing");
    for (const m of mounts.splice(0)) m.mount.unmount();
    root.replaceChildren();
    root.style.position = "relative";
    root.style.width = `${spec.width}px`;
    root.style.height = `${spec.height}px`;
    tracks = spec.tracks;
    const pending: Promise<void>[] = [];
    for (const cell of spec.cells) {
      const host = document.createElement("div");
      host.style.position = "absolute";
      host.style.left = `${cell.x}px`;
      host.style.top = `${cell.y}px`;
      root.append(host);
      const mount = mountProbe(
        host,
        probePayload({
          widgetId: cell.widgetId,
          fixture: cell.fixture,
          size: { w: cell.w, h: cell.h, config: cell.config },
        }),
      );
      mounts.push({ mount, track: cell.track });
      pending.push(mount.ready);
    }
    await Promise.all(pending);
    await nextFrame();
    await nextFrame();
  },
  async step(indices) {
    for (const { mount, track } of mounts) {
      if (track === undefined) continue;
      const frame = tracks[track]?.[indices[track]];
      if (!frame)
        throw new Error(
          `Stage: track "${track}" has no frame ${indices[track]}`,
        );
      mount.scrubTo(frame.ut);
      for (const e of frame.emits)
        mount.emit(e.channel, e.value, e.meta as never);
    }
    await nextFrame();
    await nextFrame();
    await new Promise((resolve) => setTimeout(resolve, 40));
  },
};
