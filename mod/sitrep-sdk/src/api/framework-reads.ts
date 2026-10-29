/**
 * The Topic ids the app reads on a widget's behalf, keyed by the hook or
 * component that reads them. Useful for knowing which Topics a widget does not
 * need to list in its `channels`: one that sends a command with `useCommand`
 * or is mounted by the dashboard leaves these out, and its generated page never
 * lists them. Some are registered at runtime rather than listed in the
 * contract, so the ids are plain strings. The keys other than `useCommand` name
 * parts of the app that an Uplink does not call.
 *
 * @category Reading telemetry
 */
export const FRAMEWORK_READS = {
  /** What `useCommand` reads: the pending and gated commands, and the link, delay, predicted route and predicted loss they wait on. */
  useCommand: [
    "system.uplink.pending",
    "system.uplink.gates",
    "comms.link",
    "comms.delay",
    "comms.route",
    "comms.nextLoss",
  ],
  /** What the guard that replaces a locked widget reads: Uplink health, the scene and the career mode. */
  RequiresGuard: [
    "system.uplinkHealth",
    "spaceCenter.scene",
    "spaceCenter.state",
    "career.mode",
  ],
  /** What the control stream reads to know which orbit the craft is on. */
  useControlStream: ["vessel.orbit"],
  /** What a lock scope reads to know which Topics an Uplink has gated. */
  useLockScope: ["system.uplink.gates"],
} as const satisfies Record<string, readonly string[]>;
