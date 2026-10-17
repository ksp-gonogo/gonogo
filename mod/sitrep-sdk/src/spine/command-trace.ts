import { hasHost } from "../api/host";
import { logger } from "../api/logger";
import type { CommandStatus } from "./lifecycle";

/**
 * Logs how a dispatched command ended, tagged `command`: a confirmed reply at
 * `debug`, and a refusal, failure, loss or undelivered command at `warn` with
 * the refusal code or reason. A command called lost that is answered after
 * all is logged at `info`. Every command any widget or Uplink sends settles
 * through the stream client, so this covers them all. Arguments are left
 * out: a script or a note can be long and is the operator's own text.
 * Nothing is logged when no host is installed.
 */
export function traceCommandOutcome(
  command: string,
  label: string | undefined,
  status: CommandStatus,
): void {
  if (!hasHost()) return;
  // A diagnostic must never be what breaks the command path it describes, and a test host's logger may be partial.
  try {
    write(command, label, status);
  } catch {
    // ignore: the outcome still reaches the caller
  }
}

function write(
  command: string,
  label: string | undefined,
  status: CommandStatus,
): void {
  const log = logger.tag("command");
  const named = { command, ...(label ? { label } : {}) };
  switch (status.phase) {
    case "confirmed":
      log.debug(`${command} confirmed`, named);
      return;
    case "refused":
      log.warn(`${command} refused: ${status.errorCode}`, {
        ...named,
        errorCode: status.errorCode,
        reason: status.reason,
        breach: status.breach,
      });
      return;
    case "failed":
      log.warn(`${command} failed: ${status.error.code}`, {
        ...named,
        errorCode: status.error.code,
        detail: status.error.message,
      });
      return;
    case "lost":
      log.warn(`${command} unconfirmed: ${status.reason}`, {
        ...named,
        reason: status.reason,
      });
      return;
    case "undelivered":
      log.warn(`${command} never sent: ${status.reason}`, {
        ...named,
        reason: status.reason,
      });
      return;
    case "found":
      log.info(`${command} answered after being called lost`, {
        ...named,
        outcome: status.outcome,
        ...(status.outcome === "refused"
          ? { errorCode: status.errorCode }
          : {}),
      });
      return;
    default:
      return;
  }
}
