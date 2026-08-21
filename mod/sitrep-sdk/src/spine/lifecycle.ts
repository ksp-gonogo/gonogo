import type { CommandErrorCode, LimitBreach } from "../__generated__/contract";

/**
 * Everything a refusal needs to be SAID, beyond the typed reason itself.
 *
 * The reason alone reads "ModeUnavailable", which names neither the command nor
 * a single number. `command`/`args`/`label` are what the client dispatched, kept
 * client-side (the reply carries a `requestId` and no command name, deliberately);
 * `breach` is the comparison the mod attached when the refusal had one.
 *
 * The code picks the sentence and the breach fills it in. Neither is much use
 * alone: an arm cannot say "16 of 16", and a pair of numbers does not say which
 * sentence they belong in.
 */
export interface CommandRefusalDetail {
  /** The command id that was dispatched, e.g. `career.facility.upgrade`. */
  command: string;
  /** The args it was dispatched with, verbatim. */
  args: unknown;
  /** The dispatch's own operator-facing description; `""` when it carried none. */
  label: string;
  /** The limit and the actual behind the refusal, when there is one. */
  breach?: LimitBreach;
  /**
   * The refusal in the GAME's own words, when the game had any to give: the arm
   * of `ClearToSaveStatus`, a strategy's own `CanBeActivated` reason, a
   * pre-flight test's warning title, a state member's `[Description]` name.
   *
   * Quoted rather than inferred, so no client keeps an English table of KSP's
   * vocabulary that is wrong in every other language. `errorCode` stays the
   * machine-readable half; this is never parsed.
   */
  detail?: string;
}

/**
 * One refused dispatch, as a widget surface renders it: the typed reason plus
 * everything needed to name the command and quote its numbers.
 *
 * The `id` is the dispatch's own `requestId`, so the same `dismiss(id)` clears a
 * refusal and a dead in-flight command, and the operator has one gesture rather
 * than two that look alike.
 */
export interface CommandRefusal extends CommandRefusalDetail {
  id: string;
  errorCode: CommandErrorCode;
}

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
  | ({
      phase: "refused";
      requestId: string;
      errorCode: CommandErrorCode;
    } & Partial<CommandRefusalDetail>)
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
  /** Present only on a refusal: what was dispatched, and the numbers behind the
   *  reason. See `CommandRefusalDetail`. Own properties, like `code`, so a
   *  structural reader (`classifyCommandRejection`) finds them across a bundled
   *  copy or a peer-relayed rehydration. */
  readonly command?: string;
  readonly args?: unknown;
  readonly label?: string;
  readonly breach?: LimitBreach;
  readonly detail?: string;

  constructor(
    code: string,
    message: string,
    errorCode?: CommandErrorCode,
    refusal?: CommandRefusalDetail,
  ) {
    super(message);
    this.name = "CommandError";
    this.code = code;
    this.errorCode = errorCode;
    this.command = refusal?.command;
    this.args = refusal?.args;
    this.label = refusal?.label;
    this.breach = refusal?.breach;
    this.detail = refusal?.detail;
  }
}
