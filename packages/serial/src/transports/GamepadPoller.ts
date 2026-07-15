// Shared rAF-driven poller for the Gamepad API. `navigator.getGamepads()` is
// a polled snapshot — nothing else in the platform polls today (both
// web-serial and virtual are push-based) — so N gamepad-transport instances
// must not mean N animation-frame loops. This module is a module-level
// singleton: one shared loop, a Set of per-instance frame listeners, started
// on the first subscriber and stopped on the last.
//
// It also tracks which live pad *indices* are currently claimed by a
// transport, so two instances configured for the same physical pad `id`
// (two identical controllers) don't both grab the same index, and a
// reconnect can find "the first *unclaimed* live pad whose id matches".

export type GamepadFrameListener = (
  gamepads: readonly (Gamepad | null)[],
) => void;

function readGamepads(): readonly (Gamepad | null)[] {
  const nav = (
    globalThis as {
      navigator?: { getGamepads?: () => (Gamepad | null)[] | null };
    }
  ).navigator;
  return nav?.getGamepads?.() ?? [];
}

export class GamepadPoller {
  private static instance: GamepadPoller | null = null;

  private readonly listeners = new Set<GamepadFrameListener>();
  private readonly claimed = new Set<number>();
  private rafHandle: number | null = null;

  static get(): GamepadPoller {
    if (!GamepadPoller.instance) {
      GamepadPoller.instance = new GamepadPoller();
    }
    return GamepadPoller.instance;
  }

  /** Test-only: drop the singleton (and stop its loop) so each test starts
   *  from a clean slate. Production code never calls this. */
  static resetForTests(): void {
    GamepadPoller.instance?.stopLoop();
    GamepadPoller.instance = null;
  }

  /** Subscribe to per-frame gamepad snapshots. Starts the shared loop on the
   *  first subscriber; the returned unsubscribe stops it on the last. */
  subscribe(listener: GamepadFrameListener): () => void {
    this.listeners.add(listener);
    this.startLoopIfNeeded();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopLoop();
    };
  }

  /**
   * Read the current gamepad snapshot and notify every subscriber. Public
   * so tests (and `MockGamepadAPI.step()`) can advance the poller
   * deterministically without waiting on a real animation frame — the
   * production loop calls this same method, it just also reschedules
   * itself via `requestAnimationFrame`.
   */
  tick(): void {
    const gamepads = readGamepads();
    for (const listener of this.listeners) listener(gamepads);
  }

  claim(index: number): void {
    this.claimed.add(index);
  }

  release(index: number): void {
    this.claimed.delete(index);
  }

  isClaimed(index: number): boolean {
    return this.claimed.has(index);
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }

  private startLoopIfNeeded(): void {
    if (this.rafHandle !== null) return;
    if (typeof requestAnimationFrame !== "function") return;
    const loop = () => {
      this.tick();
      this.rafHandle = requestAnimationFrame(loop);
    };
    this.rafHandle = requestAnimationFrame(loop);
  }

  private stopLoop(): void {
    if (this.rafHandle !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafHandle);
    }
    this.rafHandle = null;
  }
}
