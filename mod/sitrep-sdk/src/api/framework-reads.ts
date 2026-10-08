/**
 * Topic ids the framework subscribes to on a widget's behalf, keyed by the hook
 * or component that does it. A widget that sends a command with `useCommand`,
 * or is mounted by the dashboard, does not declare them: the scan that lists a
 * widget's reads leaves them out, and the generated reference page never shows
 * them. Some are registered at runtime rather than listed in the contract, so
 * the ids are plain strings.
 *
 * @category Reading telemetry
 */
export const FRAMEWORK_READS = {
  useCommand: [
    "system.uplink.pending",
    "system.uplink.gates",
    "comms.link",
    "comms.delay",
  ],
  RequiresGuard: [
    "system.uplinkHealth",
    "spaceCenter.scene",
    "spaceCenter.state",
    "career.mode",
  ],
  useControlStream: ["vessel.orbit"],
  useLockScope: ["system.uplink.gates"],
} as const satisfies Record<string, readonly string[]>;
