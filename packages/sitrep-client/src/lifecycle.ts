/**
 * Lifecycle state for a single dispatched command, keyed by `requestId`.
 *
 * At M2 (delay 0) a command moves `idle -> in-flight -> confirmed|failed`
 * synchronously once the stub responds, but the async contract (a Promise)
 * always holds — later milestones introduce real network latency without
 * changing this shape.
 *
 * M3 (D3) extends the in-flight phase with a predicted `etaConfirm` (the
 * absolute UT the client expects a response by — supplied by the transport,
 * never computed by the client itself) and adds a terminal `lost` phase:
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
