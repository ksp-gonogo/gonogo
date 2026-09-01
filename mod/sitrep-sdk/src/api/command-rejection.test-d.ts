// Type-level proof that an OUTSIDE author can tell the three terminal command
// outcomes apart using only this published package. Every import below comes
// from the package root, the way a third party installs it: nothing here reaches
// into `spine/`, which is unpublished, and nothing matches a code string.
//
// This exists because the gap it closes was invisible in both directions. The
// app could always tell a refusal from a failure (it has the spine's
// `CommandError` class); an Uplink could not, and no compile anywhere said so.

import {
  type CommandErrorCode,
  type CommandRejection,
  type CommandStatus,
  classifyCommandRejection,
} from "../index";

declare const status: CommandStatus;

/** Branching on the terminal phases, with the typed reason in hand. */
function chip(): string | undefined {
  switch (status.phase) {
    case "refused": {
      // The whole point: the reason is present AND typed on this arm.
      const reason: CommandErrorCode = status.errorCode;
      return `refused (${reason})`;
    }
    case "confirmed":
      return "confirmed";
    case "failed":
      return status.error.message;
    case "lost":
      return status.reason;
    case "in-flight":
      return `awaiting ${status.etaConfirm}`;
    case "idle":
      return undefined;
  }
  // A new phase must break an author's exhaustive switch at compile time, not
  // silently fall through to "no chip".
  const unhandled: never = status;
  return unhandled;
}

/** Classifying a caught rejection from `send()`. */
function describe(err: unknown): string {
  const rejection: CommandRejection = classifyCommandRejection(err);
  switch (rejection.kind) {
    case "refused": {
      const reason: CommandErrorCode = rejection.errorCode;
      return `the game said no: ${reason}`;
    }
    case "lost":
      return `no reply: ${rejection.message}`;
    case "failed":
      return `${rejection.code}: ${rejection.message}`;
  }
}

export const _authorSurfaceHolds = [chip, describe];
