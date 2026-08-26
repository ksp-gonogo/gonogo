import type { SettingDefinitionOf } from "@ksp-gonogo/sitrep-sdk";
import {
  getActiveTelemetryClient,
  registerSetting,
  registerUplinkHandle,
} from "@ksp-gonogo/sitrep-sdk";

/*
 * The one thing an operator gets to decide about RP-1's simulations: whether
 * signal delay applies during one.
 *
 * <b>Why the default is to CUT it.</b> A simulation is a ground-side
 * rehearsal. There is no spacecraft, so there is no light-time, and applying
 * one models a distance to a craft that does not exist. On a mission control
 * board that is a fiction rather than a measurement, and cutting it is the
 * honest reading.
 *
 * <b>Why it is a choice and not a rule.</b> Rehearsing under the delay the
 * real flight will have is a legitimate thing to want, and it is the whole
 * reason a controller runs a simulation in the first place. Nobody but the
 * controller knows which of the two this rehearsal is for.
 *
 * <b>Why the MOD owns the value.</b> The mod is what enforces the delay: the
 * reveal gate withholds telemetry server-side, and every command rides the
 * same light-time. A console preference the enforcer never heard would be a
 * switch wired to nothing. So the row reads the mod's own answer off
 * `flight.simulation` and writes through a command, rather than persisting
 * anything locally.
 *
 * Side-effect module: importing it runs the registration once, the same
 * lifecycle as this package's other module-load registrations.
 */

/** Must match `Sitrep.Host.Flight.FlightTopics.SimulationTopic`. */
const SIMULATION_TOPIC = "flight.simulation";

/** Must match `Gonogo.KSP.CommsCoreUplink.SetSimulationDelayPolicyCommand`. */
const SET_POLICY_COMMAND = "comms.setSimulationDelayPolicy";

/** The shape of the payload this row reads. Narrowed here rather than imported: the topic is core's, not this Uplink's. */
interface SimulationPayload {
  delayInSimulation?: boolean;
}

/**
 * The row's binding onto the live stream.
 *
 * `useSyncExternalStore` drives the row, so `read` has to be synchronous and
 * has to return the same value until something actually changes. That is what
 * the cached payload is for: the client's own `subscribe` delivers, this holds,
 * and the row re-renders on notify.
 */
class Rp1SimulationDelayPolicy {
  private wire: boolean | undefined;

  /**
   * The value this console last asked for, held only until the mod confirms
   * it.
   *
   * Without it the switch sits at its old position for a tick after a click,
   * which reads as a control that does not work. It is dropped the moment the
   * wire agrees, and dropped again if the command is refused, so the mod's
   * answer is what stands in every case but that one frame.
   */
  private pending: boolean | undefined;

  private readonly listeners = new Set<() => void>();
  private detach: (() => void) | undefined;

  read(): boolean {
    return this.pending ?? this.wire ?? false;
  }

  write(next: boolean): void {
    this.pending = next;
    this.notify();
    const client = getActiveTelemetryClient();
    if (client === undefined) {
      // Nothing is connected, so nothing can enforce the change either. Drop
      // the optimism rather than leaving the row showing a policy no mod has.
      this.pending = undefined;
      this.notify();
      return;
    }
    client
      .dispatch(SET_POLICY_COMMAND, { applyDuringSimulation: next })
      .result.catch(() => {
        this.pending = undefined;
        this.notify();
      });
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    if (this.detach === undefined) {
      const client = getActiveTelemetryClient();
      this.detach = client?.subscribe(SIMULATION_TOPIC, (value) => {
        const payload = (value ?? undefined) as SimulationPayload | undefined;
        this.wire = payload?.delayInSimulation;
        if (this.pending !== undefined && this.pending === this.wire) {
          this.pending = undefined;
        }
        this.notify();
      });
    }
    return () => {
      this.listeners.delete(cb);
      if (this.listeners.size === 0) {
        this.detach?.();
        this.detach = undefined;
      }
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export const rp1SimulationDelayPolicy = new Rp1SimulationDelayPolicy();

// The settings modal resolves a source-backed row's `sourceId` through the
// uplink-handle registry first, so this is what `read`/`write`/`subscribe`
// below are handed.
registerUplinkHandle("rp1", rp1SimulationDelayPolicy);

export const RP1_DELAY_IN_SIMULATION_SETTING = "rp1.delayInSimulation";

/** Held as well as registered, so a test asserts the row the modal renders rather than a copy of its literals. */
export const RP1_SIMULATION_DELAY_ROW: SettingDefinitionOf<"boolean"> = {
  id: RP1_DELAY_IN_SIMULATION_SETTING,
  backing: "source-backed",
  type: "boolean",
  sourceId: "rp1",
  read: (s) => (s as Rp1SimulationDelayPolicy).read(),
  write: (s, v) => {
    (s as Rp1SimulationDelayPolicy).write(v);
  },
  subscribe: (s, cb) => (s as Rp1SimulationDelayPolicy).subscribe(cb),
  category: "RP-1",
  group: "Simulation",
  label: "Signal delay during a simulation",
  description:
    "Off by default, and off is the honest reading: a simulation is a ground-side rehearsal with no spacecraft, so there is no light-time, and delaying it models a distance to a craft that is not there. Turn it on to rehearse under the conditions the real flight will have. Enforced by the mod, not by this console, so it applies to withheld telemetry and to every command alike.",
  screens: ["main"],
};

registerSetting(RP1_SIMULATION_DELAY_ROW);
