/**
 * Topic ids the framework subscribes to on a widget's behalf, keyed by the hook
 * or component that does it. A widget that sends a command with `useCommand`,
 * or is mounted by the dashboard, does not declare them: a widget's `channels`
 * leave them out, and its reference page never lists them. Some are registered
 * at runtime rather than listed in the contract, so the ids are plain strings.
 *
 * @category Reading telemetry
 */
export const FRAMEWORK_READS = {
  /** What `useCommand` reads: the pending and gated commands, and the link and delay they wait on. */
  useCommand: [
    "system.uplink.pending",
    "system.uplink.gates",
    "comms.link",
    "comms.delay",
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
