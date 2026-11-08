import type { TelemetryClient } from "@ksp-gonogo/sitrep-client";
import type { CommandSeen } from "@ksp-gonogo/sitrep-sdk/spine";

/**
 * The slice of a telemetry client that says which command centre it stands at.
 * Declared narrow so the session plain stations read from can be stood in by a
 * stub without a socket.
 */
export interface VantageReader {
  readonly selectedVantage?: string;
  readonly observedVantage?: string;
}

/**
 * The hosting screen's own connection to the mod, held for the jobs only a host
 * does: arming alarms, relaying a station's command, and the Uplinks' host
 * handle.
 *
 * It never sets a vantage, so it stays at the home command centre however the
 * screen's own picker is moved. That is the reason it exists apart from the
 * screen's display session: a picker move re-points the display, and a job
 * riding the display would move with it.
 *
 * Also records which session the plain stations read from and where it stands,
 * so a command relayed for a station that named no vantage can leave from the
 * centre that station is being shown.
 */
export class HostJobs {
  private current: TelemetryClient | undefined;
  private plain: VantageReader | undefined;
  private readonly listeners = new Set<() => void>();
  private commandView:
    | { target: TelemetryClient; view: TelemetryClient }
    | undefined;

  /** The live host-jobs connection, or `undefined` while it is being made. */
  get client(): TelemetryClient | undefined {
    return this.current;
  }

  setClient(client: TelemetryClient | undefined): void {
    if (this.current === client) return;
    this.current = client;
    for (const listener of [...this.listeners]) listener();
  }

  /**
   * The jobs connection as something to send commands on: a command that names
   * no centre leaves from the centre the screen's picker chose, the one the
   * operator sees the readings from. Everything else, reads included, is the
   * jobs connection itself. `undefined` while the connection is not open.
   *
   * The jobs connection stands at home and carries no vantage of its own, so a
   * command sent on it bare would be timed and sent from home.
   */
  commandClient(): TelemetryClient | undefined {
    const target = this.current;
    if (!target) return undefined;
    if (this.commandView?.target !== target) {
      this.commandView = {
        target,
        view: sendingFrom(target, () => this.plainStationVantage()),
      };
    }
    return this.commandView.view;
  }

  /**
   * The jobs connection as something to send commands on from `centre`: a
   * command that names no centre leaves from it, with its delay. `undefined`
   * while the connection is not open.
   */
  commandClientAt(centre: string): TelemetryClient | undefined {
    const target = this.current;
    return target ? sendingFrom(target, () => centre) : undefined;
  }

  /** Calls `listener` whenever the host-jobs connection is replaced or lost. */
  onClientChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Name the session the plain stations read from. Returns the release, which
   * only clears the record if no later session replaced it.
   */
  attachPlainStationSession(session: VantageReader): () => void {
    this.plain = session;
    return () => {
      if (this.plain === session) this.plain = undefined;
    };
  }

  /**
   * The centre a station that chose none is being shown, as a vantage a command
   * can name. Empty until the plain-station session has chosen one, which the
   * mod reads as the home command centre.
   */
  plainStationVantage(): string {
    return this.plain?.selectedVantage ?? "";
  }

  /**
   * The centre a command-vantage alarm is armed at: the one the screen chose,
   * or until it chooses, the one the mod stamped its frames with. Empty when
   * neither is known yet.
   */
  alarmVantage(): string {
    return this.plain?.selectedVantage ?? this.plain?.observedVantage ?? "";
  }
}

/**
 * `client` with every command that names no centre sent from the one
 * `defaultCentre` gives. Reads and everything else are the client itself.
 */
function sendingFrom(
  client: TelemetryClient,
  defaultCentre: () => string,
): TelemetryClient {
  const stand = (vantage: string | undefined) => vantage || defaultCentre();
  return new Proxy(client, {
    get: (target, prop) => {
      if (prop === "dispatch") {
        return (
          command: string,
          args?: unknown,
          label?: string,
          topic?: string,
          vantage?: string,
          requestId?: string,
          seen?: CommandSeen,
        ) =>
          target.dispatch(
            command,
            args,
            label,
            topic,
            stand(vantage),
            requestId,
            seen,
          );
      }
      if (prop === "dispatchGroup") {
        return (
          members: Parameters<TelemetryClient["dispatchGroup"]>[0],
          vantage?: string,
          groupId?: string,
        ) => target.dispatchGroup(members, stand(vantage), groupId);
      }
      const member = Reflect.get(target, prop, target);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
}

let registered: HostJobs | undefined;

/**
 * Make `jobs` the host-jobs link the Uplinks' host handle reads. The handle is
 * installed before any screen mounts, so it reaches the link through here.
 * Returns the release.
 */
export function registerHostJobs(jobs: HostJobs): () => void {
  registered = jobs;
  return () => {
    if (registered === jobs) registered = undefined;
  };
}

/**
 * The live host-jobs connection while a hosting screen is mounted, `undefined`
 * on a screen that holds none.
 */
export function getRegisteredHostJobs(): HostJobs | undefined {
  return registered;
}
