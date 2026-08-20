import type { CommandErrorCode } from "../__generated__/contract";

/**
 * Lifecycle state for a single dispatched command, keyed by `requestId`.
 *
 * With zero delay a command moves `idle -> in-flight -> confirmed|failed`
 * synchronously once the stub responds, but the async contract (a Promise)
 * always holds, real network latency doesn't change this shape.
 *
 * The in-flight phase carries a predicted `etaConfirm` (the
 * absolute UT the client expects a response by, supplied by the transport,
 * never computed by the client itself), and there's a terminal `lost` phase:
 * silence past `etaConfirm` (plus a small margin) is inferred as loss rather
 * than left in-flight forever. A command that DOES settle before that
 * deadline goes straight to `confirmed`/`failed` as before and never
 * transitions to `lost`.
 *
 * There are three ways for a dispatch to end badly and they are NOT
 * interchangeable, so each has its own terminal phase:
 *
 * - `lost`: no answer arrived by the predicted deadline. Nothing was decided,
 *   and the command may well have executed anyway
 * - `failed`: the machinery broke. A handler threw, a result would not
 *   serialize, the client was disposed mid-flight. Carries a free-text
 *   `message` because the cause is not an enumerable game state, and a retry
 *   may genuinely succeed
 * - `refused`: the handler RAN, the game evaluated it, and the answer was no
 *   (crew cap reached, facility already max tier, funds short). Carries the
 *   mod's typed `CommandErrorCode` and no free text, because the reason IS an
 *   enumerable game state. A retry changes nothing until the world does
 *
 * The mod already separates the last two at the wire: a well-formed
 * `CommandResult.Fail(...)` rides the normal `command-response` message, while
 * the `"error"` message type is reserved for the machinery-broke class. Folding
 * a refusal into `failed` would discard a distinction the mod deliberately
 * maintains, and would force the client to invent the free-text message that
 * `CommandResult` exists to avoid.
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
  | { phase: "refused"; requestId: string; errorCode: CommandErrorCode }
  | { phase: "lost"; requestId: string; reason: string };

/**
 * The rejection value for every dispatch that does not succeed.
 *
 * A real `Error`, not a bare object literal, because callers render it: a
 * plain `{ code, message }` reaches the operator as `[object Object]` through
 * the entirely reasonable `err instanceof Error ? err.message : String(err)`.
 * `code` is kept as an own property so the existing `E_LOST` / `E_DISPOSED`
 * discriminations keep reading the same.
 */
export class CommandError extends Error {
  readonly code: string;
  /** Present only on a refusal: the mod's typed reason, never string-matched. */
  readonly errorCode?: CommandErrorCode;

  constructor(code: string, message: string, errorCode?: CommandErrorCode) {
    super(message);
    this.name = "CommandError";
    this.code = code;
    this.errorCode = errorCode;
  }
}
