import type {
  CommandErrorCode,
  CommandGateReport,
  GateVerdict,
  LimitBreach,
} from "../__generated__/contract";
import { GateOutcome } from "../__generated__/contract";

/**
 * What the mod says about a command BEFORE anyone dispatches it, shaped for the
 * control that has to draw itself.
 *
 * <p>Deliberately the same fields a refusal carries (`errorCode`, `breach`,
 * `detail`), because they are the same fields: the mod evaluates one gate set
 * one way and the only difference is whether the arguments were supplied. A
 * control renders "the game will refuse this" through the same composer it uses
 * for "the game refused this", and the two cannot drift apart on wording.
 */
export interface CommandGateStatus {
  /**
   * The game will refuse this command right now, so the control should say so
   * rather than wait to be pressed.
   *
   * True for a Fail AND for an Unknown. Unknown is not "we don't know, try it":
   * an unevaluable gate REFUSES server-side (`ChannelEngine.EvaluateGates`), by
   * design, because a gate that cannot be read must not read as no gate. A
   * control that stayed live on an Unknown would promise something the dispatch
   * is guaranteed to deny.
   *
   * False for an Abstain, which means the answer genuinely depends on what you
   * ask the command to do. There is nothing honest to say in advance there.
   */
  blocked: boolean;
  /**
   * The command this is about. Carried because the reason has to be a SENTENCE
   * and a sentence needs a subject: without it "Unavailable: Launch Pad is
   * occupied" names no control, which in a panel of eight is not enough to act
   * on. Same field `CommandRefusalDetail` carries for the same reason.
   */
  command: string;
  /** Which authority said no. `CommandErrorCode.ModeUnavailable` when the evaluator named none. */
  errorCode: CommandErrorCode;
  /** The comparison behind a numeric refusal, when there is one. */
  breach?: LimitBreach;
  /** The game's own words, when it had any: quoted, never parsed. */
  detail?: string;
}

/**
 * This command's entry in the published gate set, or `undefined` when there is
 * none.
 *
 * <p>`undefined` covers three different situations and deliberately does not
 * distinguish them, because a control does the same thing in all three: the
 * command declares no requirements, the stream is not carrying
 * `system.uplink.gates`, or nothing is connected. In every case the client
 * knows nothing about this command in advance, which is exactly where every
 * control was before this channel existed, so the fallback is the old
 * behaviour rather than a guess.
 *
 * <p>Never treat a Pass as permission. The snapshot is up to one sampling
 * interval old and the dispatch re-evaluates the same gates against live state;
 * this exists to say no in advance, never to say yes.
 */
export function selectCommandGate(
  report: CommandGateReport | undefined,
  command: string,
): CommandGateStatus | undefined {
  const entry = report?.gates.find((gate) => gate.command === command);
  if (!entry) return undefined;
  return toGateStatus(entry.verdict, command);
}

/** One verdict as the control reads it. Exported for the widget that holds a verdict directly. */
export function toGateStatus(
  verdict: GateVerdict,
  command: string,
): CommandGateStatus {
  return {
    command,
    blocked:
      verdict.outcome === GateOutcome.Fail ||
      verdict.outcome === GateOutcome.Unknown,
    errorCode: verdict.errorCode,
    breach: verdict.breach ?? undefined,
    detail: verdict.detail || undefined,
  };
}
