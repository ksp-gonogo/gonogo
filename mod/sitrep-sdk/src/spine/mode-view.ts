import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type {
  ModeStateModel,
  ModeTimelineState,
} from "../__generated__/contract";
import type { ModeTimeline } from "../api/modes";
import { stillTrue } from "../reading";
import type { TelemetryClient } from "./client";
import {
  useActiveTelemetryClient,
  useTelemetryClientOptional,
} from "./context";
import { useTelemetry } from "./use-telemetry";
import { META_VANTAGE } from "./vantage";

/*
 * Where one screen is on the mode's timeline. The mod publishes the shared
 * position as "at this moment, playing at this rate", and each screen carries
 * it forward from when it received that. A screen with sync off keeps a
 * position of its own in the same shape and sends the mod nothing.
 */
interface Anchor {
  atUt: number;
  playing: boolean;
  rate: number;
  /** `performance.now()` when the position was true. */
  wallMs: number;
}

const SYNC_KEY = "gonogo.mode.syncTimeline";
/** Seconds between two seeks sent to the mod while a slider is dragged. */
const SEEK_EVERY_MS = 100;
/** How long the mod's position is ignored after a seek from this screen, so a drag is not pulled back by its own echo. */
const SEEK_SETTLE_MS = 300;

interface View {
  synced: boolean;
  shared: Anchor | undefined;
  local: Anchor | undefined;
  range: { startUt: number; endUt: number } | undefined;
  lastSeekMs: number;
}

function readSynced(): boolean {
  try {
    return globalThis.localStorage?.getItem(SYNC_KEY) !== "off";
  } catch {
    return true;
  }
}

const view: View = {
  synced: readSynced(),
  shared: undefined,
  local: undefined,
  range: undefined,
  lastSeekMs: Number.NEGATIVE_INFINITY,
};
const listeners = new Set<() => void>();
let version = 0;

function changed(): void {
  version += 1;
  for (const l of listeners) l();
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

const now = (): number => globalThis.performance?.now() ?? Date.now();

function positionOf(anchor: Anchor, atMs: number): number {
  const range = view.range;
  const moved = anchor.playing
    ? anchor.atUt + (anchor.rate * (atMs - anchor.wallMs)) / 1000
    : anchor.atUt;
  if (!range) return moved;
  return Math.min(range.endUt, Math.max(range.startUt, moved));
}

/**
 * The moment this screen shows on the mode's timeline now, or `undefined`
 * while the mode has no timeline. Callable from an animation frame.
 */
export function modeCursorUt(): number | undefined {
  const anchor = view.synced ? view.shared : (view.local ?? view.shared);
  return anchor ? positionOf(anchor, now()) : undefined;
}

function adoptShared(timeline: ModeTimelineState | undefined): void {
  if (!timeline) {
    if (!view.shared && !view.range && !view.local) return;
    view.shared = undefined;
    view.local = undefined;
    view.range = undefined;
    changed();
    return;
  }
  view.range = {
    startUt: Number(timeline.startUt),
    endUt: Number(timeline.endUt),
  };
  // A drag in progress on this screen is ahead of the mod's echo of it.
  if (now() - view.lastSeekMs >= SEEK_SETTLE_MS || !view.shared) {
    view.shared = {
      atUt: Number(timeline.atUt),
      playing: timeline.playing,
      rate: Number(timeline.rate),
      wallMs: now(),
    };
  }
  changed();
}

/** Test-only: forgets this screen's place on the timeline. */
export function resetModeViewForTests(): void {
  view.synced = true;
  view.shared = undefined;
  view.local = undefined;
  view.range = undefined;
  view.lastSeekMs = Number.NEGATIVE_INFINITY;
  changed();
}

/** The mode the dashboard is in, or `undefined` before the mod has said. */
export function useModeState(): ModeStateModel | undefined {
  return stillTrue(useTelemetry("mode.state"), undefined) ?? undefined;
}

/**
 * Whether this screen follows the shared timeline, and the setter. Off, the
 * screen keeps its own place and its Timeline moves this screen only. The
 * choice is kept on the device.
 */
export function useModeSync(): [boolean, (synced: boolean) => void] {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  return [
    view.synced,
    (synced: boolean) => {
      if (view.synced === synced) return;
      view.synced = synced;
      // Leaving sync starts from where the shared timeline is, held still; joining drops the screen's own place.
      view.local =
        synced || !view.shared
          ? undefined
          : {
              atUt: positionOf(view.shared, now()),
              playing: false,
              rate: view.shared.rate,
              wallMs: now(),
            };
      try {
        globalThis.localStorage?.setItem(SYNC_KEY, synced ? "on" : "off");
      } catch {
        // The choice holds for this session only.
      }
      changed();
    },
  ];
}

/** Sends a `mode.*` command, which is about the dashboard and so is never signal-delayed. */
export function sendModeCommand(
  client: TelemetryClient | undefined,
  command: string,
  args: unknown,
): void {
  if (!client) {
    // A control drawn outside the stream's provider, as a window's content is unless it is given the stream, would otherwise do nothing and say nothing.
    console.warn(
      `[modes] ${command} was not sent: the control is not inside the screen's telemetry provider`,
    );
    return;
  }
  // The answer is not awaited by a control: a refusal changes nothing on screen, and `mode.state` says what the mode is.
  client
    .dispatch(command, args, undefined, undefined, META_VANTAGE)
    .result.catch(() => {});
}

/** Enters and leaves modes, and sets a mode's inputs, from any screen. */
export function useModeControls(): {
  enter: (mode: string) => void;
  exit: (mode: string) => void;
  setInput: (mode: string, key: string, value: string) => void;
} {
  // gonogo:reads none
  const own = useTelemetryClientOptional();
  // A control in a window sits outside the provider; the screen's own client is still the one to send through.
  const active = useActiveTelemetryClient();
  const client = own ?? active;
  return useMemo(
    () => ({
      enter: (mode) => sendModeCommand(client, "mode.enter", { mode }),
      exit: (mode) => sendModeCommand(client, "mode.exit", { mode }),
      setInput: (mode, key, value) =>
        sendModeCommand(client, "mode.setInput", { mode, key, value }),
    }),
    [client],
  );
}

/** Re-renders the caller each animation frame while `active`. */
function useFrames(active: boolean): void {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    let frame = globalThis.requestAnimationFrame?.(function next() {
      tick((n) => n + 1);
      frame = globalThis.requestAnimationFrame?.(next);
    });
    return () => {
      if (frame !== undefined) globalThis.cancelAnimationFrame?.(frame);
    };
  }, [active]);
}

/**
 * The timeline of the mode the dashboard is in, with this screen's own
 * position and controls, or `undefined` while the mode has none. Synced, the
 * controls move every synced screen through the mod; with sync off they move
 * this screen only.
 */
export function useModeTimeline(): ModeTimeline | undefined {
  // gonogo:reads none
  const client = useTelemetryClientOptional();
  const state = useModeState();
  const timeline = state?.timeline ?? undefined;
  const mode = state?.mode;
  useEffect(() => adoptShared(timeline), [timeline]);
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  const anchor = view.synced ? view.shared : (view.local ?? view.shared);
  useFrames(anchor?.playing === true);

  const controls = useMemo(() => {
    let pending: number | undefined;
    let scheduled = false;
    const flush = () => {
      scheduled = false;
      if (pending === undefined) return;
      sendModeCommand(client, "mode.timeline.seek", { mode, ut: pending });
      pending = undefined;
    };
    const moveLocal = (next: Partial<Anchor>) => {
      const from = view.local ?? view.shared;
      if (!from) return;
      view.local = {
        ...from,
        atUt: positionOf(from, now()),
        ...next,
        wallMs: now(),
      };
      changed();
    };
    return {
      seek: (ut: number) => {
        if (!view.synced) {
          moveLocal({ atUt: ut });
          return;
        }
        if (view.shared) {
          view.shared = { ...view.shared, atUt: ut, wallMs: now() };
          view.lastSeekMs = now();
          changed();
        }
        pending = ut;
        if (scheduled) return;
        scheduled = true;
        setTimeout(flush, SEEK_EVERY_MS);
      },
      play: () => {
        if (!view.synced) {
          const range = view.range;
          const from = view.local ?? view.shared;
          const ended = range && from && positionOf(from, now()) >= range.endUt;
          moveLocal(
            ended && range
              ? { playing: true, atUt: range.startUt }
              : { playing: true },
          );
          return;
        }
        sendModeCommand(client, "mode.timeline.play", { mode, rate: 0 });
      },
      pause: () => {
        if (!view.synced) {
          moveLocal({ playing: false });
          return;
        }
        sendModeCommand(client, "mode.timeline.pause", { mode, rate: 0 });
      },
      setRate: (rate: number) => {
        if (!view.synced) {
          moveLocal({ rate });
          return;
        }
        // One command either way, so a rate chosen on a held timeline never sets it playing.
        if (view.shared?.playing === true) {
          sendModeCommand(client, "mode.timeline.play", { mode, rate });
          return;
        }
        sendModeCommand(client, "mode.timeline.pause", { mode, rate });
      },
      exit: () => sendModeCommand(client, "mode.exit", { mode }),
    };
  }, [client, mode]);

  // The same array for as long as the mod states the same timeline, so a reader that keys work on the marks does it once.
  const marks = useMemo(
    () =>
      (timeline?.marks ?? []).map((m) => ({
        ut: Number(m.ut),
        label: m.label,
      })),
    [timeline],
  );

  if (!timeline || !anchor) return undefined;
  const at = positionOf(anchor, now());
  const end = Number(timeline.endUt);
  return {
    start: Number(timeline.startUt),
    end,
    at,
    seek: controls.seek,
    marks,
    ...(timeline.launchUt === null || timeline.launchUt === undefined
      ? {}
      : { launchUt: Number(timeline.launchUt) }),
    ...(timeline.rates.length > 0
      ? {
          playback: {
            playing: anchor.playing && at < end,
            rate: anchor.rate,
            rates: timeline.rates.map(Number),
            play: controls.play,
            pause: controls.pause,
            setRate: controls.setRate,
            exit: controls.exit,
          },
        }
      : {}),
  };
}
