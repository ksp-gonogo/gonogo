import { logger } from "@ksp-gonogo/logger";
import {
  accepted,
  HOST_RECORD_TOPIC,
  type HostRecordView,
  readHostRecord,
  readRoleAnswer,
  readStationCheck,
  type StationCheckAnswer,
} from "./hostRecord";

/** The slice of a telemetry client the role is claimed and kept over. */
export interface RoleConnection {
  subscribe(topic: string, cb: (value: unknown) => void): () => void;
  dispatch(command: string, args?: unknown): { result: Promise<unknown> };
}

/**
 * Where a local screen stands with the host role.
 *
 * `waiting` until the mod has published the record and answered the first
 * claim. `hosting` while this screen holds the role; `takeover` is true when it
 * took the role over from a host it had joined, and `generation` is the mod's
 * grant count at its latest claim. `joined` while another screen
 * holds it, or nobody does and the mod has not yet let this one claim.
 */
export type HostRoleState =
  | { kind: "waiting" }
  | {
      kind: "hosting";
      record: HostRecordView;
      takeover: boolean;
      generation: number;
    }
  | { kind: "joined"; record: HostRecordView };

const WAITING: HostRoleState = { kind: "waiting" };

/** How often to claim again before the mod has said how often to heartbeat. */
const DEFAULT_HEARTBEAT_MS = 5_000;

/**
 * One local screen's part in deciding which screen hosts the game.
 *
 * The mod is the referee. This screen reads `host.record`, claims the role with
 * the token it keeps for itself, and while it holds the role sends a heartbeat
 * at the interval the claim was answered with. A heartbeat answered "not the
 * holder" means another screen took over while this one was cut off, and this
 * screen steps down at once. While another screen holds the role it watches the
 * record, and claims as soon as the role is free.
 */
export class HostRole {
  private connection: RoleConnection | undefined;
  private detachRecord: (() => void) | undefined;
  private record: HostRecordView | undefined;
  private answered = false;
  private holds = false;
  private ownId = "";
  private takeover = false;
  private generation = 0;
  private claiming = false;
  private heartbeatMs = DEFAULT_HEARTBEAT_MS;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private current: HostRoleState = WAITING;
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  private released = false;

  constructor(readonly token: string) {}

  /**
   * Claim and keep the role over `connection`, the screen's own connection to
   * the mod. A replacement connection claims again, so the role follows the
   * screen onto it. Returns the detach.
   */
  attach(connection: RoleConnection): () => void {
    this.detachRecord?.();
    this.connection = connection;
    this.detachRecord = connection.subscribe(HOST_RECORD_TOPIC, (value) =>
      this.onRecord(value),
    );
    if (this.answered) this.claim();
    return () => {
      if (this.connection !== connection) return;
      this.detachRecord?.();
      this.detachRecord = undefined;
      this.connection = undefined;
    };
  }

  get state(): HostRoleState {
    return this.current;
  }

  /** The id the mod gave this screen's token, empty until a claim is granted. */
  get holderId(): string {
    return this.ownId;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Give the role up at once, so the next screen does not wait out the grace,
   * and claim it no more. For a deliberate hand-over, never for a page going
   * away, which may be a reload that is to keep the role.
   */
  release(): void {
    this.released = true;
    if (!this.holds) return;
    this.connection?.dispatch("host.release", { token: this.token });
    this.loseRole();
  }

  /** Replace the join code. Resolves false when the mod refused. */
  async regenerateCode(): Promise<boolean> {
    return accepted(await this.send("host.code.regenerate", {}));
  }

  /** Approve a remote station by its credential. Resolves false when the mod refused. */
  async approveStation(credential: string, name: string): Promise<boolean> {
    return accepted(
      await this.send("host.station.approve", { credential, name }),
    );
  }

  /** Revoke an approved station by its id. Resolves false when the mod refused. */
  async revokeStation(stationId: string): Promise<boolean> {
    return accepted(await this.send("host.station.revoke", { stationId }));
  }

  /** Whether a station's credential is approved; `undefined` when the mod could not say. */
  async checkStation(
    credential: string,
  ): Promise<StationCheckAnswer | undefined> {
    return readStationCheck(
      await this.send("host.station.check", { credential }),
    );
  }

  dispose(): void {
    this.disposed = true;
    this.stopHeartbeat();
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
    this.detachRecord?.();
    this.listeners.clear();
  }

  private async send(command: string, args: object): Promise<unknown> {
    const connection = this.connection;
    if (!connection) return undefined;
    try {
      return await connection.dispatch(command, { token: this.token, ...args })
        .result;
    } catch (err) {
      logger.warn(`[HostRole] ${command} did not complete`, {
        err: String(err),
      });
      return undefined;
    }
  }

  private onRecord(payload: unknown): void {
    const record = readHostRecord(payload);
    if (!record) return;
    this.record = record;
    if (this.holds && record.held && record.holderId !== this.ownId) {
      this.loseRole();
    }
    /* A holder that reads the role free was away past its grace and claims it
       back, hosting on until the mod answers either way. */
    if (!this.answered || !record.held) this.claim();
    this.publish();
  }

  private claim(): void {
    if (this.claiming || this.disposed || this.released || !this.connection)
      return;
    this.claiming = true;
    void this.send("host.claim", {}).then((result) => {
      this.claiming = false;
      if (this.disposed) return;
      const answer = readRoleAnswer(result);
      if (!answer) {
        this.scheduleRetry();
        return;
      }
      this.heartbeatMs = answer.heartbeatSeconds * 1000;
      this.answered = true;
      if (answer.holds) {
        this.takeRole(answer.holderId, answer.generation);
      } else {
        if (this.holds) this.loseRole();
        if (this.record && !this.record.held) this.scheduleRetry();
      }
      this.publish();
    });
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== undefined || this.disposed) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (!this.answered || !this.record?.held) this.claim();
    }, this.heartbeatMs);
  }

  private takeRole(holderId: string, generation: number): void {
    if (!this.holds) this.takeover = this.current.kind === "joined";
    this.holds = true;
    this.ownId = holderId;
    this.generation = generation;
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.heartbeatMs);
  }

  private heartbeat(): void {
    void this.send("host.heartbeat", {}).then((result) => {
      const answer = readRoleAnswer(result);
      // No answer at all is a link that is down, which the grace exists to ride out.
      if (!answer || answer.holds || !this.holds) return;
      logger.warn(
        "[HostRole] another screen holds the role now, stepping down",
      );
      this.loseRole();
      this.publish();
    });
  }

  private loseRole(): void {
    this.holds = false;
    this.takeover = false;
    this.stopHeartbeat();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer === undefined) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private publish(): void {
    const next = this.derive();
    if (sameState(next, this.current)) return;
    this.current = next;
    for (const listener of [...this.listeners]) listener();
  }

  private derive(): HostRoleState {
    if (!this.answered || !this.record) return WAITING;
    if (this.holds) {
      return {
        kind: "hosting",
        record: this.record,
        takeover: this.takeover,
        generation: this.generation,
      };
    }
    return { kind: "joined", record: this.record };
  }
}

function sameState(a: HostRoleState, b: HostRoleState): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "waiting" || b.kind === "waiting") return true;
  if (a.record !== b.record) return false;
  return a.kind !== "hosting" || b.kind !== "hosting"
    ? true
    : a.takeover === b.takeover && a.generation === b.generation;
}
