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
 * One dispatch nothing ever answered, as a widget surface renders it.
 *
 * Separate from {@link CommandRefusal} because the two say opposite things. A
 * refusal is the game's verdict and carries a typed reason; a loss carries no
 * reason at all, because nothing was decided and the command may well have
 * executed. What the operator is owed here is the identity of the command that
 * went quiet, and nothing that reads as a judgement.
 *
 * It exists because a loss can have NO queue entry to render. The engine drops
 * a command for an unreachable subject before it mints a `PendingUplink`
 * (`ChannelEngine`'s `if (!SubjectConnected(NodeId))` gate), so the whole delay
 * UI, derived from that queue, had nothing to draw for the command's entire
 * life while the button settled as though it had worked.
 *
 * The `id` is the dispatch's own `requestId`, so one `dismiss(id)` clears a
 * loss, a refusal and a dead in-flight command alike.
 */
export interface CommandLoss {
  id: string;
  /** The command id that was dispatched, e.g. `vessel.control.setSas`. */
  command: string;
  /** The args it was dispatched with, verbatim. */
  args: unknown;
  /** The dispatch's own operator-facing description; `""` when it carried none. */
  label: string;
}

/**
 * One dispatch that was called lost and then answered after all, as a widget
 * surface renders it.
 *
 * A {@link CommandLoss} that came back. It carries everything the loss did, so
 * a surface that was drawing the loss can draw this in its place without going
 * looking for the command's identity again, plus the one thing the loss never
 * had: what the answer actually said.
 *
 * `lost` means WE DO NOT KNOW, never IT DID NOT HAPPEN, and this is the case
 * that proves it. Nothing here prevents or undoes the execution; the command ran
 * (or was refused, or broke) exactly as it would have done had the reply arrived
 * on time, and the only thing that was ever wrong was our silence about it.
 */
export type CommandFound = CommandLoss & CommandFoundOutcome;

/**
 * What a late reply turned out to say, and why the three are kept apart.
 *
 * They send the operator in opposite directions, which is the whole reason
 * `found` is not one flat phase:
 *
 * - `ran`: the command executed. An operator who re-sent it after being told it
 *   was lost has now executed it twice, and this is the only place that fact
 *   exists
 * - `refused`: the command arrived and the game said no. A re-send is refused
 *   again for the same reason until the world changes, so the reason is the
 *   actionable half and it is carried here in full
 * - `errored`: the command arrived and the machinery broke on the far side. It
 *   reached the game, which is the found part, and a retry may genuinely work,
 *   which is what separates it from a refusal
 *
 * Folding these together would repeat the mistake `CommandStatus` already
 * refused to make when it kept `refused` out of `failed`.
 */
export type CommandFoundOutcome =
  | { outcome: "ran"; result: unknown }
  | ({ outcome: "refused"; errorCode: CommandErrorCode } & Partial<
      Omit<CommandRefusalDetail, "command" | "args" | "label">
    >)
  | { outcome: "errored"; error: { code: string; message: string } };

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
 *
 * `lost` is the one terminal phase that is not the end. It says WE DO NOT KNOW,
 * never IT DID NOT HAPPEN, and a reply can still turn up long after it: the
 * correlation entry is retained, and the transport re-sends what it queued while
 * the socket was down. A late reply moves the command to `found`, which is the
 * only backwards transition in this type and is deliberate. Nothing about it
 * prevents the execution, because preventing it would trade an honest
 * uncertainty for a false certainty and lose the property that makes `lost`
 * worth having.
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
  | { phase: "lost"; requestId: string; reason: string }
  | ({ phase: "found"; requestId: string } & CommandFoundOutcome);

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
