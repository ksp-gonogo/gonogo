/** A delay under this many seconds is over before a warp could shorten it, so there is no wait to offer. */
export const FIRST_SIGNAL_MIN_OWLT_SECONDS = 5;

interface ActiveCraft {
  vesselId: string;
  name: string;
}

/** What the screen knows of the one-way delay to the active craft. */
export type KnownDelay =
  | { kind: "unknown" }
  | { kind: "none" }
  | { kind: "known"; seconds: number };

interface FirstSignalPorts {
  /** The craft the game names as active, or null while it names none. */
  readActive(): ActiveCraft | null;
  /** The game's universal time right now, or null before the clock has one. */
  gameUtNow(): number | null;
  /** Whether the active craft's own telemetry is arriving live at this screen. */
  ownDataObserved(): boolean;
  /** The one-way signal delay to the active craft: not known yet, no route to it, or a figure. */
  readDelay(): KnownDelay;
  /** A rough one-way delay to the active craft from where the catalog has it, or null where none can be made. */
  readEstimate(): number | null;
}

export interface FirstSignalWait {
  vesselName: string;
  /** The delay the first signal takes: the real figure, else the estimate, else null. */
  owltSeconds: number | null;
  /** Whether {@link owltSeconds} is the estimate. */
  estimated: boolean;
}

/**
 * Follows a switch of the active craft to the moment that craft's first signal
 * reaches the command centre.
 *
 * The craft's telemetry starts streaming when the game switches to it and
 * reaches the centre one signal delay later. The wait is announced from the
 * switch itself, before the delay to the new craft is known, and ends only when
 * the craft's own data is observed here: an estimate of the delay, or a held or
 * modelled reading, never ends it.
 */
export class FirstSignalWatch {
  private lastVesselId: string | null = null;
  private waiting: { name: string; switchedAtUt: number | null } | null = null;

  constructor(private readonly ports: FirstSignalPorts) {}

  /** The delay to show and whether it is an estimate, or null when there is no wait to offer for this craft. */
  private figure(): { seconds: number | null; estimated: boolean } | null {
    const delay = this.ports.readDelay();
    if (delay.kind === "none") return null;
    if (delay.kind === "known") {
      return delay.seconds < FIRST_SIGNAL_MIN_OWLT_SECONDS
        ? null
        : { seconds: delay.seconds, estimated: false };
    }
    const estimate = this.ports.readEstimate();
    if (estimate === null) return { seconds: null, estimated: false };
    return estimate < FIRST_SIGNAL_MIN_OWLT_SECONDS
      ? null
      : { seconds: estimate, estimated: true };
  }

  /** The wait to show, or null when none is awaited, there is no route to the craft, or the delay is too short to wait out. */
  snapshot(): FirstSignalWait | null {
    if (this.waiting === null) return null;
    const figure = this.figure();
    if (figure === null) return null;
    return {
      vesselName: this.waiting.name,
      owltSeconds: figure.seconds,
      estimated: figure.estimated,
    };
  }

  /** The first signal awaited, with the game's time it is expected at where a delay is known or estimated, or null while none is awaited. */
  awaited(): { arrivesAtUt: number | null } | null {
    if (this.waiting === null) return null;
    const figure = this.figure();
    if (figure === null) return null;
    const at = this.waiting.switchedAtUt;
    return {
      arrivesAtUt:
        figure.seconds !== null && at !== null ? at + figure.seconds : null,
    };
  }

  /**
   * Called each tick. Returns "ended" on the tick the wait ends, which a warp
   * toward it must follow with a drop to 1x.
   */
  observe(): "ended" | undefined {
    const active = this.ports.readActive();
    if (active !== null) {
      if (this.lastVesselId !== null && this.lastVesselId !== active.vesselId) {
        /* The game's own time as the clock has it, not the stamp on the statement, which a replay can carry a signal delay early. */
        this.waiting = {
          name: active.name,
          switchedAtUt: this.ports.gameUtNow(),
        };
      }
      this.lastVesselId = active.vesselId;
    }
    if (this.waiting === null) return undefined;
    if (this.waiting.switchedAtUt === null) {
      this.waiting.switchedAtUt = this.ports.gameUtNow();
    }
    if (this.ports.ownDataObserved()) {
      this.waiting = null;
      return "ended";
    }
    return undefined;
  }
}
