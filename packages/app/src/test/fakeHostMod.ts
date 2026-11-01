import type { RoleConnection } from "../hosting/HostRole";

/**
 * The game mod's host record, kept by the rules the mod keeps it by: one
 * holder at a time, a claim by the holder's own token taken as a reload, the
 * role freed a grace after the holder's last heartbeat or the close of its
 * connection, and the code and approvals open only to the holder. Answers on a
 * later microtask, as a socket does. Time is `Date.now()`, so fake timers move
 * it.
 */
export class FakeHostMod {
  readonly heartbeatSeconds = 5;
  readonly graceSeconds = 15;
  code = "ABC234";
  private holderToken: string | undefined;
  private holderConnection: FakeRoleConnection | undefined;
  private holderAway = false;
  private deadline = 0;
  /** How many times the role has been granted, as the mod counts. */
  private generation = 0;
  private readonly stations = new Map<
    string,
    { id: string; name: string; approvedAt: number }
  >();
  private readonly connections = new Set<FakeRoleConnection>();
  /** Every command any connection sent, in order. */
  readonly sent: { command: string; args: Record<string, unknown> }[] = [];

  /** A connection to this mod, as one screen opens it. */
  connect(): FakeRoleConnection {
    const connection = new FakeRoleConnection(this);
    this.connections.add(connection);
    return connection;
  }

  /** Free the role if its grace has run out, and publish the record. */
  tick(): void {
    this.expire();
    this.publish();
  }

  /**
   * Hand the role to `token` as another screen claiming it after this one was
   * cut off past its grace would.
   */
  seize(token: string): void {
    this.holderToken = token;
    this.holderConnection = undefined;
    this.holderAway = false;
    this.deadline = Date.now() + this.graceSeconds * 1000;
    this.publish();
  }

  /** Approve a credential without a holder, as a save that already had it. */
  seedStation(credential: string, name: string): void {
    this.stations.set(credential, {
      id: `id-${credential}`,
      name,
      approvedAt: 0,
    });
  }

  record() {
    return {
      held: this.holderToken !== undefined,
      holderAway: this.holderToken !== undefined && this.holderAway,
      holderId: this.holderToken ? idOf(this.holderToken) : "",
      code: this.code,
      stations: [...this.stations.values()],
    };
  }

  /** @internal */
  closed(connection: FakeRoleConnection): void {
    this.connections.delete(connection);
    if (this.holderConnection === connection) {
      this.holderAway = true;
      this.deadline = Date.now() + this.graceSeconds * 1000;
      this.publish();
    }
  }

  /** @internal */
  answer(
    connection: FakeRoleConnection,
    command: string,
    args: Record<string, unknown>,
  ): unknown {
    this.sent.push({ command, args });
    this.expire();
    const token = String(args.token ?? "");
    const holds = token !== "" && token === this.holderToken;
    const roleReply = (granted: boolean) => ({
      success: true,
      payload: {
        holds: granted,
        holderId: this.holderToken ? idOf(this.holderToken) : "",
        heartbeatSeconds: this.heartbeatSeconds,
        graceSeconds: this.graceSeconds,
        generation: this.generation,
      },
    });
    const refused = { success: false, errorCode: "wrongState" };
    switch (command) {
      case "host.claim":
        if (this.holderToken !== undefined && !holds && !this.holderAway)
          return roleReply(false);
        this.generation += 1;
        this.take(token, connection);
        return roleReply(true);
      case "host.heartbeat":
        if (!holds) return roleReply(false);
        this.take(token, connection);
        return roleReply(true);
      case "host.release":
        if (!holds) return refused;
        this.holderToken = undefined;
        this.holderConnection = undefined;
        this.publish();
        return { success: true };
      case "host.code.regenerate":
        if (!holds) return refused;
        this.code = this.code === "XYZ789" ? "QRS456" : "XYZ789";
        this.publish();
        return { success: true };
      case "host.station.approve": {
        if (!holds) return refused;
        const credential = String(args.credential);
        const existing = this.stations.get(credential);
        this.stations.set(credential, {
          id: `id-${credential}`,
          name: String(args.name),
          approvedAt: existing?.approvedAt ?? Date.now(),
        });
        this.publish();
        return { success: true };
      }
      case "host.station.revoke":
        if (!holds) return refused;
        for (const [credential, station] of this.stations) {
          if (station.id === args.stationId) this.stations.delete(credential);
        }
        this.publish();
        return { success: true };
      case "host.station.check": {
        if (!holds) return refused;
        const station = this.stations.get(String(args.credential));
        return {
          success: true,
          payload: {
            approved: station !== undefined,
            stationId: station?.id ?? "",
            name: station?.name ?? "",
          },
        };
      }
      default:
        return refused;
    }
  }

  private take(token: string, connection: FakeRoleConnection): void {
    const changed = this.holderToken !== token || this.holderAway;
    this.holderToken = token;
    this.holderConnection = connection;
    this.holderAway = false;
    this.deadline = Date.now() + this.graceSeconds * 1000;
    if (changed) this.publish();
  }

  private expire(): void {
    if (this.holderToken === undefined || Date.now() < this.deadline) return;
    this.holderToken = undefined;
    this.holderConnection = undefined;
    this.holderAway = false;
  }

  private publish(): void {
    const record = this.record();
    for (const connection of this.connections) connection.push(record);
  }
}

function idOf(token: string): string {
  return `holder-${token.slice(0, 6)}`;
}

/** One screen's connection to a {@link FakeHostMod}. */
export class FakeRoleConnection implements RoleConnection {
  private readonly listeners = new Set<(value: unknown) => void>();
  private open = true;

  constructor(private readonly mod: FakeHostMod) {}

  subscribe(topic: string, cb: (value: unknown) => void): () => void {
    if (topic !== "host.record") return () => {};
    this.listeners.add(cb);
    const record = this.mod.record();
    queueMicrotask(() => {
      if (this.listeners.has(cb)) cb(record);
    });
    return () => {
      this.listeners.delete(cb);
    };
  }

  dispatch(command: string, args?: unknown): { result: Promise<unknown> } {
    if (!this.open) {
      return { result: Promise.reject(new Error("connection closed")) };
    }
    const fields =
      typeof args === "object" && args !== null
        ? (args as Record<string, unknown>)
        : {};
    return {
      result: Promise.resolve().then(() =>
        this.mod.answer(this, command, fields),
      ),
    };
  }

  /** The connection drops, as a closed laptop lid or a lost network does. */
  close(): void {
    this.open = false;
    this.listeners.clear();
    this.mod.closed(this);
  }

  /** @internal */
  push(record: unknown): void {
    for (const cb of [...this.listeners]) cb(record);
  }
}
