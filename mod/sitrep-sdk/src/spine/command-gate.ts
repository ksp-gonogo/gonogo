import type {
  CommandGate,
  CommandGateReport,
  GateVerdict,
  LimitBreach,
} from "../__generated__/contract";
import { GateOutcome } from "../__generated__/contract";
import { CommandErrorCode } from "../__generated__/error-codes";

/**
 * What the mod says about a command before anyone sends it, shaped for the
 * control that has to draw itself. {@link UseCommandResult.gate} carries it.
 *
 * It carries the same `errorCode`, `breach` and `detail` a refusal does, so a
 * control can say "the game will refuse this" in the same words it uses for
 * "the game refused this".
 *
 * @category Commands
 */
export interface CommandGateStatus {
  /**
   * The game checked this command's requirements and they fail. The control
   * should say so rather than wait to be pressed. It is `false` when the
   * answer depends on the arguments the command is given, since there is
   * nothing to say in advance then.
   */
  blocked: boolean;
  /**
   * The mod could not check this command's requirements at all, for instance
   * while a save is still loading or between scenes. This is not a refusal and
   * must not be drawn as one: it is no judgement about the command, so render
   * the control as you would an ungated one, live and pressable. The dispatch
   * still decides, and a refusal then names itself. `detail` says why, for a
   * diagnostic surface.
   */
  undetermined: boolean;
  /** The command this is about, so the reason can be shown beside the control it concerns. */
  command: string;
  /** Which authority said no. `CommandErrorCode.ModeUnavailable` when the evaluator named none. */
  errorCode: CommandErrorCode;
  /** The refinement's id, when the evaluator named one more specific than `errorCode`. */
  reason?: string;
  /** The comparison behind a numeric refusal, when there is one. */
  breach?: LimitBreach;
  /** The game's own words, when it had any: quoted, never parsed. */
  detail?: string;
}

/**
 * This command's entry in the published gate set, or `undefined` when there is
 * none.
 *
 * `undefined` covers three different situations and deliberately does not
 * distinguish them, because a control does the same thing in all three: the
 * command declares no requirements, the stream is not carrying
 * `system.uplink.gates`, or nothing is connected. In every case the client
 * knows nothing about this command in advance, so the fallback is to behave as
 * though there were no gate channel at all rather than to guess.
 *
 * Never treat a Pass as permission. The snapshot is up to one sampling
 * interval old and the dispatch re-evaluates the same gates against live state;
 * this exists to say no in advance, never to say yes.
 */
export function selectCommandGate(
  report: CommandGateReport | undefined,
  command: string,
  args?: unknown,
): CommandGateStatus | undefined {
  const entry = report?.gates.find((gate) => gate.command === command);
  if (!entry) return undefined;
  const item = itemVerdict(entry, args);
  return toGateStatus(item ?? entry.verdict, command);
}

/**
 * The verdict for the item a call names, when the gate depends on which item
 * that is and the mod published one for it. A call that names no item, or an
 * item with no published verdict, gets nothing here and falls back to the
 * command's own verdict, which is then an Abstain: a live control.
 */
function itemVerdict(
  entry: CommandGate,
  args: unknown,
): GateVerdict | undefined {
  // An older mod publishes neither field, which reads exactly as a gate with no items.
  const argument = entry.itemArgument;
  if (!argument || !entry.items?.length) return undefined;
  if (typeof args !== "object" || args === null) return undefined;
  const named = (args as Record<string, unknown>)[argument];
  if (typeof named !== "string" && typeof named !== "number") return undefined;
  const value = String(named);
  return entry.items.find((item) => item.value === value)?.verdict;
}

/** One verdict as the control reads it. Exported for the widget that holds a verdict directly. */
export function toGateStatus(
  verdict: GateVerdict,
  command: string,
): CommandGateStatus {
  return {
    command,
    blocked: verdict.outcome === GateOutcome.Fail,
    undetermined: verdict.outcome === GateOutcome.Unknown,
    errorCode: verdict.errorCode ?? CommandErrorCode.ModeUnavailable,
    reason: verdict.reason,
    breach: verdict.breach ?? undefined,
    detail: verdict.detail || undefined,
  };
}
