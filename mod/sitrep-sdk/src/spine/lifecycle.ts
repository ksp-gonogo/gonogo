import type { LimitBreach } from "../__generated__/contract";
import type { CommandErrorCode } from "../__generated__/error-codes";

/**
 * Everything beyond the typed reason that is needed to tell the operator why a
 * command was refused: the command, its arguments, its label and the limit it
 * breached. Useful for naming the refused command and quoting its numbers. The
 * base of {@link CommandRefusal}, which {@link useCommand} returns.
 *
 * `command`, `args` and `label` are what this client dispatched, and `breach`
 * is the comparison the mod attached when the refusal had one. The code picks
 * the sentence and the breach fills it in.
 *
 * @category Commands
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
   * The refusal in the game's own words, when the game gave any, such as the
   * reason a strategy cannot be activated or the title of a failed pre-flight
   * check. Show it as it is: `errorCode` is the machine-readable half, and this
   * text is not for parsing.
   */
  detail?: string;
  /**
   * The refinement's id, when the refusal was more specific than its root
   * `errorCode`. `describeErrorCode` reads its sentence.
   */
  reason?: string;
}

/**
 * One command the game refused, as a widget renders it: the typed reason plus
 * everything needed to name the command and quote its numbers. Useful for
 * telling the operator why a command did not take effect. Listed in the
 * `refusals` that {@link useCommand} returns.
 *
 * The `id` is the dispatch's own `requestId`, so the same `dismiss(id)` clears a
 * refusal and a dead in-flight command.
 *
 * @category Commands
 */
export interface CommandRefusal extends CommandRefusalDetail {
  /** The dispatch's request id, which `dismiss` takes. */
  id: string;
  /** Why the game refused it: the root code. A more specific `reason` is on the detail. */
  errorCode: CommandErrorCode;
}

/**
 * One command that nothing replied to, as a widget renders it. Useful for
 * telling the operator that the outcome of a command sent to a vessel is not
 * known. Listed in the `losses` that {@link useCommand} returns.
 *
 * A refusal is the game's verdict and carries a typed reason. A loss carries no
 * reason, because nothing was decided and the command may well have run. It
 * names the command that went quiet and makes no claim about what happened. A
 * loss can have no entry on the delay rail, for instance a command sent to a
 * vessel with no connection, so this is where such a command is shown.
 *
 * The `id` is the dispatch's own `requestId`, so one `dismiss(id)` clears a
 * loss, a refusal and a dead in-flight command alike.
 *
 * @category Commands
 */
export interface CommandLoss {
  /** The dispatch's request id, which `dismiss` takes. */
  id: string;
  /** The command id that was dispatched, e.g. `vessel.control.setSas`. */
  command: string;
  /** The args it was dispatched with, verbatim. */
  args: unknown;
  /** The dispatch's own operator-facing description; `""` when it carried none. */
  label: string;
}

/**
 * One command that never left this machine, as a widget renders it. Useful for
 * telling the operator that a command did not run and can safely be sent again.
 * Listed in the `undelivered` that {@link useCommand} returns.
 *
 * It is a {@link CommandLoss} that turned out the other way from a
 * {@link CommandFound}: the connection held the command for a connection that
 * never came back and has stopped retrying, so it reached no mod and no game
 * and nothing ran. A command that is `lost` may have run; this one did not, so
 * sending it again cannot do it twice.
 *
 * It carries everything the loss did, plus the transport's own reason.
 *
 * @category Commands
 */
export interface CommandUndelivered extends CommandLoss {
  /** Why it will never go, in the transport's own words. */
  reason: string;
}

/**
 * One command the mod answered with a fault rather than a reply, as a widget
 * renders it: it expired or was cancelled on its way, a continuous input was
 * dropped where it would have waited, or a game load undid it. Useful for
 * telling the operator what became of a command that did not run. Listed in the
 * `failures` that {@link useCommand} returns.
 *
 * It is not a refusal, which is the game's verdict on the command itself, and
 * not a loss, where nothing came back. `code` says what became of it.
 *
 * @category Commands
 */
export interface CommandFailure extends CommandLoss {
  /** The fault the mod answered with, a `FaultCode` id. `describeErrorCode` gives its sentence. */
  code: string;
  /** What the mod said of it, in its own words. */
  reason: string;
}

/**
 * One command that was reported lost and then replied to after all, as a widget
 * renders it. Useful for telling the operator what a command reported lost
 * actually did. Listed in the `founds` that {@link useCommand} returns.
 *
 * It is a {@link CommandLoss} that came back. It carries everything the loss
 * did, plus the one thing the loss never had: what the reply actually said.
 *
 * `lost` means the outcome was not known, not that the command did not happen.
 * The command ran, was refused or broke exactly as it would have had the reply
 * arrived on time; `outcome` says which.
 *
 * @category Commands
 */
export type CommandFound = CommandLoss & CommandFoundOutcome;

/**
 * What a late reply to a command reported lost turned out to say. Useful for
 * telling the operator whether the command ran, was refused or errored. Held in
 * each {@link CommandFound} that {@link useCommand} returns.
 *
 * The three outcomes call for different responses:
 *
 * - `ran`: the command executed. An operator who sent it again after being told
 *   it was lost has now executed it twice
 * - `refused`: the command arrived and the game said no. A re-send is refused
 *   again for the same reason until the world changes, so the reason is the
 *   actionable half and it is carried here in full
 * - `errored`: the command arrived and the machinery broke on the far side. It
 *   reached the game, and a retry may work, which separates it from a refusal
 *
 * @category Commands
 */
export type CommandFoundOutcome =
  | {
      /** The command ran. */
      outcome: "ran";
      /** The command's reply. */
      result: unknown;
    }
  | ({
      /** The command was refused. */
      outcome: "refused";
      /** Why it was refused. */
      errorCode: CommandErrorCode;
    } & Partial<Omit<CommandRefusalDetail, "command" | "args" | "label">>)
  | {
      /** The command errored. */
      outcome: "errored";
      /** The error it came back with. */
      error: { code: string; message: string };
    };

/**
 * Where the latest dispatch of a command is, as the `status` of a
 * {@link useCommand} handle reports it, by `phase`:
 *
 * - `idle`: nothing has been sent
 * - `in-flight`: sent, with `etaConfirm` the UT a reply is expected by
 * - `confirmed`: the command ran, and `result` is its reply
 * - `refused`: the game received it and said no, with `errorCode` as the
 *   reason. Sending it again is refused again until something in the game
 *   changes
 * - `failed`: something broke on the way, such as the mod's handler throwing,
 *   described by `error`. Sending it again may work
 * - `lost`: no reply arrived by `etaConfirm`. The command may still have run
 * - `found`: a lost command whose reply arrived late, with what it said
 * - `undelivered`: it never left this machine, because the link did not come
 *   back. It did not run, so it is safe to send again
 *
 * A `lost` command can still become `found` (its reply arrived late) or
 * `undelivered` (the connection gave up on it); every other phase after
 * `in-flight` is final.
 *
 * @category Commands
 */
// On the wire a refusal is a CommandResult.Fail on command-response; the "error" message type is the failed class.
export type CommandStatus =
  | {
      /** Nothing has been sent. */
      phase: "idle";
    }
  | {
      /** The command is on its way. */
      phase: "in-flight";
      /** Identifies the send. */
      requestId: string;
      /** When the reply is due, in UT seconds. */
      etaConfirm: number;
      /** What the mod said of a command it accepted against the odds, as a sentence to show: a continuous input that its centre's plan says will be dropped on the way. Absent for an ordinary command. */
      warning?: string;
    }
  | {
      /** The command ran and was answered. */
      phase: "confirmed";
      /** Identifies the send. */
      requestId: string;
      /** The command's reply. */
      result: unknown;
    }
  | {
      /** The command failed. */
      phase: "failed";
      /** Identifies the send. */
      requestId: string;
      /** The error it came back with. */
      error: { code: string; message: string };
    }
  | ({
      /** The mod refused the command. */
      phase: "refused";
      /** Identifies the send. */
      requestId: string;
      /** Why it was refused. */
      errorCode: CommandErrorCode;
    } & Partial<CommandRefusalDetail>)
  | {
      /** No reply came back, so the command may have run. */
      phase: "lost";
      /** Identifies the send. */
      requestId: string;
      /** A sentence describing the loss. */
      reason: string;
    }
  | {
      /** The command never left, so it did not run. */
      phase: "undelivered";
      /** Identifies the send. */
      requestId: string;
      /** A sentence saying why it did not leave. */
      reason: string;
    }
  | ({
      /** A lost command was answered after all. */
      phase: "found";
      /** Identifies the send. */
      requestId: string;
    } & CommandFoundOutcome);

/**
 * The error a command's promise rejects with whenever the command does not
 * succeed, carrying the fault `code`. Useful for telling the operator why a
 * command did not take effect. Rejected by the functions that {@link useCommand}
 * returns.
 *
 * It is a real `Error`, so `err instanceof Error ? err.message : String(err)`
 * gives the operator a sentence. `code` is an own property, so the `E_LOST`
 * marker and every `FaultCode` read the same way.
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
  readonly reason?: string;

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
    this.reason = refusal?.reason;
  }
}
