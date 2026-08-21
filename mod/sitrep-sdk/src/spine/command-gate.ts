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
   * The game EVALUATED this command's requirements and said no. The control
   * should say so rather than wait to be pressed.
   *
   * Fail ONLY. Never an Unknown, and the distinction is load-bearing rather than
   * pedantic: see {@link undetermined}.
   *
   * Never an Abstain either, which means the answer genuinely depends on what
   * you ask the command to do. There is nothing honest to say in advance there.
   */
  blocked: boolean;
  /**
   * The mod could not evaluate this command's gates at all: an authority that
   * was not there to ask.
   *
   * <p><b>This is not a refusal and must never be drawn as one.</b> The reasons
   * are mostly structural or transient and none of them is the game's judgement
   * about the command: `ScenarioUpgradeableFacilities.Instance` is null in a
   * SANDBOX save (the scenario is career/mission only), `FlightGlobals` is not
   * ready mid scene-load, an Uplink declared a gate kind and forgot its
   * evaluator. Rendering any of those as a dark control with a confident
   * sentence teaches the operator a false belief about their own save, and does
   * it permanently, which is worse than saying nothing.</p>
   *
   * <p>So a control with an undetermined gate renders exactly as an ungated one:
   * live, pressable, claiming nothing. The dispatch is the authority, and a
   * refusal that arrives then at least names itself as one at the moment it
   * happens.</p>
   *
   * <p>Kept as its OWN flag rather than folded into `blocked` because the wire
   * has always told the two apart (`GateOutcome.Unknown` vs `GateOutcome.Fail`)
   * and the client is where the distinction was at risk of being lost. `detail`
   * carries why, for a diagnostic surface.</p>
   */
  undetermined: boolean;
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
    blocked: verdict.outcome === GateOutcome.Fail,
    undetermined: verdict.outcome === GateOutcome.Unknown,
    errorCode: verdict.errorCode,
    breach: verdict.breach ?? undefined,
    detail: verdict.detail || undefined,
  };
}
