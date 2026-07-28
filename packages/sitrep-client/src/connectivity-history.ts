/**
 * A small, view-clock-frame-keyed connectivity history buffer — backs
 * `useCommand`'s `pathConnectedDuring` predicate (Task 4a in the delayed-
 * command-ux plan: "if the client doesn't already retain `comms.link`
 * connectivity history, add a small buffer; keep it in sitrep-client, not
 * ui-kit"). Records `comms.link.connected` transitions stamped at the
 * caller's `nowUt` and answers "was the path continuously connected across
 * [fromUt, toUt]?" — the question `classifyRetained`'s `lost` branch needs.
 *
 * Structural subset of the `CommsLink` wire payload this module reads.
 */
export interface CommsLinkLike {
  connected: boolean;
}

interface ConnectivityTransition {
  atUt: number;
  connected: boolean;
}

export class ConnectivityHistory {
  private transitions: ConnectivityTransition[] = [];

  /**
   * Record an observed connectivity state at `atUt`. Only appends when the
   * state actually changed (or this is the first-ever observation) — a
   * flat run of "still connected" samples doesn't grow the history.
   * Callers must record in non-decreasing `atUt` order (the real-time
   * `useUtNow` clock this is fed from is monotonic outside a rewind).
   */
  record(atUt: number, connected: boolean): void {
    const last = this.transitions[this.transitions.length - 1];
    if (last && last.connected === connected) return;
    this.transitions.push({ atUt, connected });
  }

  /**
   * Was the path continuously connected across `[fromUt, toUt]`? No
   * observation before `fromUt` reads as connected — the same
   * "undefined/unknown = connected" convention the kOS terminal's own
   * no-path gate uses (only a CONFIRMED disconnect blocks anything).
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

  /** Drop transitions entirely before `beforeUt` — bounds memory growth over a long session. */
  prune(beforeUt: number): void {
    let cut = 0;
    for (let i = 0; i < this.transitions.length - 1; i++) {
      if (this.transitions[i + 1].atUt <= beforeUt) cut = i + 1;
      else break;
    }
    if (cut > 0) this.transitions = this.transitions.slice(cut);
  }
}
