/**
 * Lifecycle state for a single dispatched command, keyed by `requestId`.
 *
 * At M2 (delay 0) a command moves `idle -> in-flight -> confirmed|failed`
 * synchronously once the stub responds, but the async contract (a Promise)
 * always holds — later milestones introduce real network latency without
 * changing this shape.
 */
export type CommandStatus =
  | { phase: "idle" }
  | { phase: "in-flight"; requestId: string }
  | { phase: "confirmed"; requestId: string; result: unknown }
  | {
      phase: "failed";
      requestId: string;
      error: { code: string; message: string };
    };
