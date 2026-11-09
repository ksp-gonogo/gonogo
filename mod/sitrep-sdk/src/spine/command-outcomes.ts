import type {
  CommandFailure,
  CommandFound,
  CommandLoss,
  CommandRefusal,
  CommandUndelivered,
} from "../api/types";
import type { TelemetryClient } from "./client";

/** What became of the commands sent under one command id, as one immutable snapshot. */
export interface CommandOutcomeSet {
  readonly refusals: CommandRefusal[];
  readonly losses: CommandLoss[];
  readonly founds: CommandFound[];
  readonly undelivered: CommandUndelivered[];
  readonly failures: CommandFailure[];
}

type Listener = () => void;

const UNDONE_BY_LOAD = "undoneByLoad";

export const NO_OUTCOMES: CommandOutcomeSet = {
  refusals: [],
  losses: [],
  founds: [],
  undelivered: [],
  failures: [],
};

/**
 * Outcomes held for one client, keyed by command id, so an outcome outlives the
 * widget that sent the command. A reader sees every outcome of its command id,
 * whichever control sent it, and tells its own apart by args and label.
 *
 * A game load that starts a new timeline drops every outcome except those
 * saying that load undid the command, which are dropped at the load after it.
 */
export class CommandOutcomeStore {
  private readonly byCommand = new Map<string, CommandOutcomeSet>();
  private readonly listeners = new Set<Listener>();
  private localSeq = 0;
  private readonly stopSweep: () => void;
  private readonly stopTimeline: () => void;
  /** The ids of the outcomes the last load kept. */
  private keptByLastLoad = new Set<string>();

  constructor(private readonly client: TelemetryClient) {
    this.stopSweep = client.subscribeStore(() => this.sweep());
    this.stopTimeline = client.onTimelineChange(() => this.followLoad());
  }

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  get(command: string): CommandOutcomeSet {
    return this.byCommand.get(command) ?? NO_OUTCOMES;
  }

  /** A number no other local refusal of this client has used. */
  nextLocalSeq(): number {
    this.localSeq += 1;
    return this.localSeq;
  }

  edit<Key extends keyof CommandOutcomeSet>(
    command: string,
    key: Key,
    update: (prev: CommandOutcomeSet[Key]) => CommandOutcomeSet[Key],
  ): void {
    const current = this.get(command);
    const next = update(current[key]);
    if (next === current[key]) return;
    this.byCommand.set(command, { ...current, [key]: next });
    this.notify();
    if (key === "losses") this.sweep();
  }

  /** Drops the outcome with this id, of whatever kind. */
  dismiss(command: string, id: string): void {
    const current = this.byCommand.get(command);
    if (!current) return;
    const without = <Entry extends { id: string }>(list: Entry[]): Entry[] => {
      const keep = list.filter((entry) => entry.id !== id);
      return keep.length === list.length ? list : keep;
    };
    const next: CommandOutcomeSet = {
      refusals: without(current.refusals),
      losses: without(current.losses),
      founds: without(current.founds),
      undelivered: without(current.undelivered),
      failures: without(current.failures),
    };
    if (
      next.refusals === current.refusals &&
      next.losses === current.losses &&
      next.founds === current.founds &&
      next.undelivered === current.undelivered &&
      next.failures === current.failures
    ) {
      return;
    }
    this.byCommand.set(command, next);
    this.notify();
  }

  dispose(): void {
    this.stopSweep();
    this.stopTimeline();
    this.listeners.clear();
  }

  /*
   * An outcome the load undid can be answered just before the frame that says
   * the timeline changed, so it is kept through one load and its news is not
   * lost. Everything else belongs to the flight the load abandoned.
   */
  private followLoad(): void {
    if (this.byCommand.size === 0) return;
    const kept = new Set<string>();
    for (const [command, outcomes] of [...this.byCommand]) {
      const failures = outcomes.failures.filter(
        (f) => f.code === UNDONE_BY_LOAD && !this.keptByLastLoad.has(f.id),
      );
      for (const f of failures) kept.add(f.id);
      if (failures.length === 0) {
        this.byCommand.delete(command);
      } else {
        this.byCommand.set(command, { ...NO_OUTCOMES, failures });
      }
    }
    this.keptByLastLoad = kept;
    this.notify();
  }

  private notify(): void {
    for (const cb of [...this.listeners]) cb();
  }

  /*
   * A loss the client has since heard back about is promoted to a found, and
   * one it learned never left is promoted to undelivered. The dispatch promise
   * rejected as lost and never settles twice, so the client's own status
   * store is where the correction arrives, and this listens there for as long
   * as the client lives rather than for as long as a widget is mounted.
   */
  private sweep(): void {
    let changed = false;
    for (const [command, outcomes] of this.byCommand) {
      if (outcomes.losses.length === 0) continue;
      const promoted: CommandFound[] = [];
      const unsent: CommandUndelivered[] = [];
      for (const loss of outcomes.losses) {
        const status = this.client.getCommand(loss.id);
        if (status.phase === "undelivered") {
          unsent.push({ ...loss, reason: status.reason });
          continue;
        }
        if (status.phase !== "found") continue;
        promoted.push(
          status.outcome === "refused"
            ? {
                ...loss,
                outcome: "refused",
                errorCode: status.errorCode,
                reason: status.reason,
                breach: status.breach,
                detail: status.detail,
              }
            : status.outcome === "errored"
              ? { ...loss, outcome: "errored", error: status.error }
              : { ...loss, outcome: "ran", result: status.result },
        );
      }
      if (promoted.length === 0 && unsent.length === 0) continue;
      this.byCommand.set(command, {
        ...outcomes,
        losses: outcomes.losses.filter(
          (l) =>
            !promoted.some((f) => f.id === l.id) &&
            !unsent.some((u) => u.id === l.id),
        ),
        founds:
          promoted.length === 0
            ? outcomes.founds
            : [
                ...outcomes.founds,
                ...promoted.filter(
                  (f) => !outcomes.founds.some((seen) => seen.id === f.id),
                ),
              ],
        undelivered:
          unsent.length === 0
            ? outcomes.undelivered
            : [
                ...outcomes.undelivered,
                ...unsent.filter(
                  (u) => !outcomes.undelivered.some((seen) => seen.id === u.id),
                ),
              ],
      });
      changed = true;
    }
    if (changed) this.notify();
  }
}

const stores = new WeakMap<TelemetryClient, CommandOutcomeStore>();

/** The outcome store of a client, made on first use. */
export function commandOutcomesOf(
  client: TelemetryClient,
): CommandOutcomeStore {
  let store = stores.get(client);
  if (!store) {
    store = new CommandOutcomeStore(client);
    stores.set(client, store);
  }
  return store;
}
