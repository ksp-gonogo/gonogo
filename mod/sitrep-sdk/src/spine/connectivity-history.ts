/*
 * A small, view-clock-frame-keyed connectivity history buffer: backs
 * `useCommand`'s `pathConnectedDuring` predicate. Records
 * `comms.link.connected` transitions stamped at the caller's `nowUt` and
 * answers "was the path continuously connected across [fromUt, toUt]?": the
 * question `classifyRetained`'s `lost` branch needs.
 */

/**
 * The part of the `comms.link` payload that {@link ConnectivityHistory} reads:
 * whether the radio path between the command centre and the vessel is
 * connected, or `null` when nothing is reported yet (no craft on screen, or
 * one whose link the game has not yet solved). Useful for feeding the history
 * from the stream without passing the whole payload. Used by the delay-aware
 * command hook, which records only a reported state.
 */
export interface CommsLinkLike {
  connected?: boolean | null;
}

interface ConnectivityTransition {
  atUt: number;
  connected: boolean;
}

/** The most changes of state a history keeps. A window that starts before the oldest of them reads as connected up to it, as an unobserved one does. */
const MAX_TRANSITIONS = 512;

/**
 * A record of when the radio path between the command centre and a vessel was
 * connected, stamped in universal time. Useful for deciding whether a command
 * sent over that path was able to reach the vessel, since a disconnect at any
 * moment in between loses it. Used by the delay-aware command hook to judge
 * whether a command was lost in flight.
 */
export class ConnectivityHistory {
  private transitions: ConnectivityTransition[] = [];

  /**
   * Records whether the path was connected at universal time `atUt`. A sample
   * is kept only when the state changed or it is the first observation, so a
   * run of unchanged samples adds nothing. An `atUt` earlier than the last one
   * recorded means the game has gone back to that instant, as after a
   * quickload, and everything recorded from then on is forgotten. Only the
   * newest {@link MAX_TRANSITIONS} changes are kept.
   */
  record(atUt: number, connected: boolean): void {
    while (
      this.transitions.length > 0 &&
      this.transitions[this.transitions.length - 1].atUt > atUt
    ) {
      this.transitions.pop();
    }
    const last = this.transitions[this.transitions.length - 1];
    if (last && last.connected === connected) return;
    this.transitions.push({ atUt, connected });
    if (this.transitions.length > MAX_TRANSITIONS) {
      this.transitions = this.transitions.slice(-MAX_TRANSITIONS);
    }
  }

  /** How many changes of state are held. */
  get size(): number {
    return this.transitions.length;
  }

  /**
   * Whether the path was continuously connected across `[fromUt, toUt]`. Useful
   * for telling the operator whether a command sent at `fromUt` could have
   * reached the vessel by `toUt`. An
   * unknown state reads as connected: no observation before `fromUt` counts as
   * connected, and only a confirmed disconnect returns false.
   */
  connectedDuring(fromUt: number, toUt: number): boolean {
    let connectedAtStart = true;
    for (const t of this.transitions) {
      if (t.atUt > fromUt) break;
      connectedAtStart = t.connected;
    }
    if (!connectedAtStart) return false;

    for (const t of this.transitions) {
      if (t.atUt <= fromUt) continue;
      if (t.atUt > toUt) break;
      if (!t.connected) return false;
    }
    return true;
  }

  /** Drops the recorded changes that end before `beforeUt`, keeping the one in force at that time, so a long session does not grow the history without limit. */
  prune(beforeUt: number): void {
    let cut = 0;
    for (let i = 0; i < this.transitions.length - 1; i++) {
      if (this.transitions[i + 1].atUt <= beforeUt) cut = i + 1;
      else break;
    }
    if (cut > 0) this.transitions = this.transitions.slice(cut);
  }
}
