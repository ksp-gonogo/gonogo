/**
 * Lifecycle state for a single dispatched command, keyed by `requestId`.
 *
 * With zero delay a command moves `idle -> in-flight -> confirmed|failed`
 * synchronously once the stub responds, but the async contract (a Promise)
 * always holds — real network latency doesn't change this shape.
 *
 * The in-flight phase carries a predicted `etaConfirm` (the
 * absolute UT the client expects a response by — supplied by the transport,
 * never computed by the client itself), and there's a terminal `lost` phase:
 * silence past `etaConfirm` (plus a small margin) is inferred as loss rather
 * than left in-flight forever. A command that DOES settle before that
 * deadline goes straight to `confirmed`/`failed` as before and never
 * transitions to `lost`.
 */
export type CommandStatus =
  | { phase: "idle" }
  | { phase: "in-flight"; requestId: string; etaConfirm: number }
  | { phase: "confirmed"; requestId: string; result: unknown }
  | {
      phase: "failed";
      requestId: string;
      error: { code: string; message: string };
    }
  | { phase: "lost"; requestId: string; reason: string };
