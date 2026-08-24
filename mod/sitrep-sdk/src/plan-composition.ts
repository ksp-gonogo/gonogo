import type {
  ComposedBurn,
  SendManeuverPlanArgs,
} from "./__generated__/contract";
import { classifyCommandRejection } from "./api/command-rejection";
import type { UseCommandResult } from "./spine/use-command";
import type { Value } from "./value";

/** The command the engine registers for this. Not an Uplink's. */
export const SEND_PLAN_COMMAND = "vessel.maneuver.plan.send";

/** What a caller states about a plan it composed. */
export interface ComposedPlan {
  /**
   * The burns, in order. An EMPTY array clears the craft's plan, which is a
   * real instruction, so it is sent rather than treated as nothing to do.
   */
  burns: ComposedBurn[];

  /**
   * The instant the state this plan was built from was actually TRUE.
   *
   * <p>Supplied by the caller rather than worked out here, and that is the whole
   * point of it being a parameter. Only the caller knows which reading it
   * planned against, and the honest value is that reading's own `asOfUt`. A hook
   * computing "now minus the delay" would produce a plausible number belonging
   * to no sample, and the divergence measured against it later would be measured
   * against a fiction.</p>
   */
  observedAt: Value<"ut">;

  /** Which craft. */
  vesselId?: string;

  /**
   * Stable per-intent id, so a plan retransmitted after a silence is recognised
   * as the same plan rather than applied twice. The caller's to supply, because
   * only it knows whether a send is a repeat or a new decision.
   */
  requestId?: string;

  /** How far the plan is asked to run. */
  desiredFinalTimeUt?: number;
}

export interface SendPlanOutcome {
  accepted: boolean;
  /** Why not, when it was not accepted. */
  refusal?: string;
}

export interface SendPlanHandle {
  /**
   * Transmit the plan. Resolves with the game's answer, or with a refusal when
   * the message never left.
   */
  send: (plan: ComposedPlan) => Promise<SendPlanOutcome>;

  /** True while a send is outstanding. */
  pending: boolean;

  /** The most recent outcome, or null before one has been attempted. */
  outcome: SendPlanOutcome | null;

  /**
   * The underlying dispatch, for `usePanelDelay(handle.command)`.
   *
   * <p>Exposed because the delay rail lives in the kit and this package cannot
   * reach it: a widget sending a plan has to contribute the schedule itself,
   * exactly as it would for any other command. Without it the send throws on
   * commit rather than quietly shipping a control with no delay UX, which is
   * the guard working, but the handle has to be reachable for the caller to
   * satisfy it.</p>
   */
  command: UseCommandResult;
}

/**
 * A message that never left, as a refusal a caller can render.
 *
 * <p>Separate and exported because the distinction matters and is otherwise
 * untestable without mocking the transport, which this codebase does not do. A
 * plan that did not reach the game is NOT a plan the craft declined: one is a
 * network fact and the other a mission fact, and showing the second for the
 * first would have an operator believe their craft rejected a plan it never
 * saw.</p>
 */
export function sendRefusalFromError(error: unknown): SendPlanOutcome {
  const rejection = classifyCommandRejection(error);
  if (rejection.kind === "refused") {
    // The plan DID reach the game and the craft declined it, so the craft's own
    // words are the answer. Reporting this as a message that never left would
    // have an operator retransmit a plan that has already been considered and
    // turned down.
    return {
      accepted: false,
      refusal: rejection.detail ?? rejection.message,
    };
  }
  if (rejection.kind === "lost") {
    // Nothing was decided, and the plan may have been installed anyway. Saying
    // so is the whole value: a retransmit here can double a plan rather than
    // replace it.
    return {
      accepted: false,
      refusal: `No answer to the plan arrived: ${rejection.message}. It may have been installed anyway.`,
    };
  }
  return {
    accepted: false,
    refusal: `The plan did not reach the game: ${rejection.message}`,
  };
}

/**
 * Why this plan cannot be transmitted, or undefined when it can.
 *
 * <p>Exported so a caller can grey a control out on the SAME answer the send
 * refuses on, rather than on a second opinion about it, and so the checks are
 * testable without a mounted provider.</p>
 */
export function whyNotSendable(
  plan: ComposedPlan,
  composedAtViewUt: number | undefined,
): string | undefined {
  if (composedAtViewUt === undefined) {
    return "No view clock is mounted, so there is nothing to record as the instant this plan was composed against.";
  }
  if (plan.observedAt.magnitude > composedAtViewUt) {
    return "This plan was built from a state later than the view it was composed at, which cannot have been seen from here.";
  }
  return undefined;
}

/**
 * The plan in the shape the command takes.
 *
 * <p>The two instants come from different places on purpose. The composition
 * instant is the view clock, which the caller's host holds; how old the
 * information already was is the caller's, because only it knows which reading
 * it used. Together they let the receiving side measure the divergence between
 * the state that was planned against and the state that received the plan;
 * either one guessed makes that measurement meaningless while still producing a
 * number.</p>
 */
export function planSendArgs(
  plan: ComposedPlan,
  composedAtViewUt: number,
): SendManeuverPlanArgs {
  return {
    vesselId: plan.vesselId,
    requestId: plan.requestId,
    composedAtViewUt,
    observedAtUt: plan.observedAt.magnitude,
    desiredFinalTimeUt: plan.desiredFinalTimeUt,
    // Magnitudes, not `Value`s. The generated burn types its instants and its
    // Δv as unit-bound values, which is right for everything that READS one, and
    // the receiving side binds each to a plain double. A `Value` reaching it is
    // refused with "cannot bind wire value of type Dictionary to numeric
    // Double", and from INSIDE the handler: the whole plan is lost rather than
    // one field, and the throw marks the entire vessel uplink unavailable for
    // the rest of the session. Unwrapped here because this is the function whose
    // job is the shape the command takes; every caller building that shape by
    // hand would get to discover it the same way.
    burns: plan.burns.map((burn) => ({
      ignitionUt: burn.ignitionUt.magnitude,
      frame: burn.frame,
      dvRadial: burn.dvRadial.magnitude,
      dvNormal: burn.dvNormal.magnitude,
      dvPrograde: burn.dvPrograde.magnitude,
      inertiallyFixed: burn.inertiallyFixed,
      thrust: burn.thrust?.magnitude,
      specificImpulse: burn.specificImpulse?.magnitude,
    })),
  } as unknown as SendManeuverPlanArgs;
}

/**
 * The outcome a command reply describes.
 *
 * <p>A reply that did not say it succeeded is a refusal, not an unknown. The
 * engine answers every dispatch it accepted, so an absent success flag means the
 * craft declined, and treating it as "no news" would leave a control spinning
 * over a decision that has already been made.</p>
 */
export function outcomeOfReply(
  reply: { success?: boolean; detail?: string } | undefined,
): SendPlanOutcome {
  if (reply?.success) {
    return { accepted: true };
  }
  // Never an empty refusal. A caller renders whatever is here, so a decline that
  // arrived without a reason would draw an empty box: worse than saying nothing,
  // because the operator can see that something answered and cannot see what.
  return {
    accepted: false,
    refusal:
      reply?.detail && reply.detail.length > 0
        ? reply.detail
        : "The craft declined the plan and gave no reason. Check the flight-plan write surface is armed.",
  };
}
