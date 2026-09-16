/**
 * The clock a motion scene's timers run on, so a film is the same film twice.
 *
 * The driver pins what a page can READ off a clock (`Date.now`, `new Date()`,
 * `performance.now`) before any module loads. That says nothing about WHEN a
 * callback runs, and a film is made of callbacks: a wheel stepping on a
 * `setInterval`, a held input released by a `setTimeout`. Both used to fire on
 * wall time while the driver spent real, machine-dependent milliseconds taking
 * screenshots, so the frame a change landed on moved run to run. The film of a
 * camera slewed by a held stick produced three different fingerprints from three
 * renders of unchanged code; a rate wheel did the same before its interval was
 * taken.
 *
 * Here time is an INPUT: a `waitMs` step is an amount of the scene's own clock,
 * and every timer due within it fires, in order, before the frame is shot.
 *
 * ## Two phases, because setup code legitimately waits on wall time
 *
 * A scene mounts before it runs. `beforeScene` opens a WebRTC session,
 * `afterMount` waits for a track to attach: real work that resolves on a real
 * timer, and a clock that only moves when a step says so would hang on the first
 * `await`.
 *
 * So the clock is LIVE while the scene is being set up and SEALED for the film:
 *
 * - live: `setTimeout` still schedules for real, and every registration is
 *   recorded. `setInterval` is fake from the start, because an interval that
 *   ticks during setup has already changed what frame zero shows.
 * - sealed ({@link sealSceneClock}, once the setup hooks have returned): the
 *   clock owns everything. Any recorded timeout that has not fired yet is
 *   cancelled and re-registered at its NOMINAL delay, measured from the first
 *   frame. A setup that says "release the stick 1400ms from now" therefore means
 *   1400ms of film, whatever the machine was doing while the page was loading.
 *
 * Only a motion scene with a waiting step opens one; a still renders under the
 * page's own timers throughout.
 *
 * `requestAnimationFrame` is never taken, which is what rules out reaching for
 * playwright's `page.clock`: that one fakes animation frames too, and every step
 * of this probe settles on two of them, so a paused clock deadlocks the first
 * step of the scene it was installed for.
 */

type TimerFn = (...args: unknown[]) => void;

interface Scheduled {
  fn: TimerFn;
  args: unknown[];
  /** Scene-clock instant this is next due at. */
  at: number;
  /** Repeat period, or `null` for a one-shot. */
  every: number | null;
}

/** Whatever the host's own `setTimeout` hands back: a number in a browser. */
type RealHandle = ReturnType<typeof globalThis.setTimeout>;

interface Live {
  fn: TimerFn;
  args: unknown[];
  /** What the caller asked for, which is what survives the seal. */
  delay: number;
  realId: RealHandle;
}

/**
 * The page's own timer functions, kept while the clock holds the globals.
 *
 * `original` is what `closeSceneClock` puts back. The other three are the same
 * functions BOUND to `globalThis`, because in a browser they are methods of
 * `window` and a detached `original.setTimeout(...)` throws "Illegal
 * invocation". That lands as a page error rather than a caught one, so every
 * render in the run fails and none of the frames say why.
 */
interface Installed {
  original: {
    setTimeout: typeof globalThis.setTimeout;
    clearTimeout: typeof globalThis.clearTimeout;
    setInterval: typeof globalThis.setInterval;
    clearInterval: typeof globalThis.clearInterval;
  };
  setTimeout: (fn: TimerFn, ms: number) => RealHandle;
  clearTimeout: (handle?: RealHandle) => void;
  clearInterval: (handle?: RealHandle) => void;
}

let real: Installed | null = null;
let sealed = false;
let now = 0;
/** Far above any real timer id one page reaches, so an id this clock did not
 *  mint is recognisable and goes back to the page's own timer functions. */
let nextId = 1_000_000_001;
const scheduled = new Map<number, Scheduled>();
const live = new Map<number, Live>();

/** Whether the clock owns every timer, i.e. the film has started. */
export function sceneClockIsSealed(): boolean {
  return sealed;
}

/** The scene clock's current instant, ms since the first frame. */
export function sceneClockNow(): number {
  return now;
}

/**
 * Take the page's timers for the length of one scene. Call before the mount:
 * the widget's own timers have to register here rather than on the page's.
 */
export function openSceneClock(): void {
  if (real) return;
  const installed: Installed = {
    original: {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
    },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
  };
  real = installed;
  sealed = false;
  now = 0;
  globalThis.setTimeout = ((fn: TimerFn, ms?: number, ...args: unknown[]) => {
    const delay = Math.max(0, Number(ms) || 0);
    const id = nextId++;
    if (sealed) {
      scheduled.set(id, { fn, args, at: now + delay, every: null });
      return id;
    }
    // Live: real, so an awaiting setup hook still resolves, and recorded, so the
    // seal can carry it into the film if it has not fired by then.
    const realId = installed.setTimeout(() => {
      live.delete(id);
      fn(...args);
    }, delay);
    live.set(id, { fn, args, delay, realId });
    return id;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = ((handle?: RealHandle) => {
    const id = Number(handle);
    if (scheduled.delete(id)) return;
    const pending = live.get(id);
    if (pending) {
      live.delete(id);
      installed.clearTimeout(pending.realId);
      return;
    }
    installed.clearTimeout(handle);
  }) as typeof globalThis.clearTimeout;
  globalThis.setInterval = ((fn: TimerFn, ms?: number, ...args: unknown[]) => {
    const every = Math.max(1, Number(ms) || 0);
    const id = nextId++;
    scheduled.set(id, { fn, args, at: now + every, every });
    return id;
  }) as typeof globalThis.setInterval;
  globalThis.clearInterval = ((handle?: RealHandle) => {
    if (handle !== undefined && scheduled.delete(Number(handle))) return;
    installed.clearInterval(handle);
  }) as typeof globalThis.clearInterval;
}

/**
 * End the setup phase: every timer from here on is the scene's, and every
 * timeout the setup left pending is rebased onto the first frame.
 *
 * Rebasing at the NOMINAL delay rather than at what is left of it is the whole
 * point. "Release the stick in 1400ms", asked for while the page was still
 * settling, is a statement about the film and not about the machine, so the
 * remainder a real clock would have counted down is exactly the quantity that
 * has to be thrown away.
 */
export function sealSceneClock(): void {
  if (!real || sealed) return;
  sealed = true;
  now = 0;
  for (const [id, pending] of live) {
    real.clearTimeout(pending.realId);
    scheduled.set(id, {
      fn: pending.fn,
      args: pending.args,
      at: pending.delay,
      every: null,
    });
  }
  live.clear();
}

/** Give the page its timers back, before the next scene mounts under them. */
export function closeSceneClock(): void {
  if (!real) return;
  // A live timer outlives the scene that registered it and would fire into
  // whatever mounts next, which is a frame nobody can account for.
  for (const pending of live.values()) {
    real.clearTimeout(pending.realId);
  }
  globalThis.setTimeout = real.original.setTimeout;
  globalThis.clearTimeout = real.original.clearTimeout;
  globalThis.setInterval = real.original.setInterval;
  globalThis.clearInterval = real.original.clearInterval;
  real = null;
  sealed = false;
  scheduled.clear();
  live.clear();
}

/**
 * Move the scene clock `ms` forward, firing exactly the callbacks that fall due
 * and no others.
 *
 * Ties go to the older registration, so two timers due at the same instant fire
 * in the order the page created them rather than in whatever order a hash map
 * happens to yield.
 */
export function advanceSceneClock(ms: number): void {
  if (!real) return;
  const target = now + Math.max(0, ms);
  let fired = 0;
  for (;;) {
    let soonestId: number | undefined;
    let soonest: Scheduled | undefined;
    for (const [id, timer] of scheduled) {
      if (!soonest || timer.at < soonest.at) {
        soonest = timer;
        soonestId = id;
      }
    }
    if (!soonest || soonestId === undefined || soonest.at > target) break;
    now = soonest.at;
    if (soonest.every === null) {
      // Removed BEFORE the call: a one-shot that schedules its successor from
      // inside its own callback must not be resurrected by this entry.
      scheduled.delete(soonestId);
    } else {
      soonest.at += soonest.every;
    }
    soonest.fn(...soonest.args);
    fired++;
    // A handler rescheduling itself faster than the clock moves would spin here
    // forever, and a render that hangs says nothing about why.
    if (fired > 10_000) {
      throw new Error(
        `render probe: advancing ${ms}ms of scene time fired ${fired} ` +
          "callbacks without draining, so something is rescheduling faster " +
          "than the clock moves.",
      );
    }
  }
  now = target;
}
