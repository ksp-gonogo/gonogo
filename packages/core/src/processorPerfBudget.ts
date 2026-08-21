import {
  setProcessorEvaluationRecorder,
  setProcessorNotificationRecorder,
} from "@ksp-gonogo/sitrep-client";
import { PerfBudget } from "./perf/PerfBudget";

/**
 * Evaluation-rate budget for the Processor evaluator (contribution-slots-spec
 * §14). The evaluator lives in the sitrep-client spine and cannot import core's
 * PerfBudget (sitrep-client -> core would cycle), so it records through an
 * injected recorder seam (`setProcessorEvaluationRecorder`, the same shape as
 * WebSocketTransport.onStreamFrame). This module is core-side, where PerfBudget
 * lives, and owns the actual budget plus the one-time wiring.
 *
 * Threshold ~5x a busy steady state: one compute per active processor per frame
 * at ~60fps with a few dozen active processors lands well under 5000/sec, so a
 * breach means a runaway (a processor re-evaluating off-frame, or a fanned-out
 * dependency cycle) rather than normal load.
 */
export const PROCESSOR_EVAL_BUDGET = new PerfBudget({
  name: "Processor evaluations/sec",
  threshold: 5000,
  windowMs: 1000,
  unit: "evaluations",
});

setProcessorEvaluationRecorder(() => PROCESSOR_EVAL_BUDGET.record());

/**
 * Fan-out budget for the same evaluator, and the one that measures what a
 * dashboard actually pays: an evaluation is one `compute` call, a notification
 * is a React re-render in one consumer, so N consumers of one processor cost N.
 *
 * It exists because the two numbers used to be identical by construction. The
 * evaluator compared results with `Object.is`, and every processor anyone has
 * written allocates, so every consumer of every processor was woken on every
 * frame whether or not a thing on the wire had moved. The evaluation budget
 * could not see that (the evaluations were correct and wanted), and the
 * consolidation of thirteen re-derivations onto processors would have traded N
 * derivations for one derivation plus N wakeups with nothing measuring the
 * second half. Recorded once per listener told, so the ratio against
 * PROCESSOR_EVAL_BUDGET is readable straight off the Perf Budgets widget.
 *
 * Threshold: post-fix steady state is only the processors whose answer really
 * does move each frame, a handful of them with a few consumers each, so ~500/s
 * at 60fps is a busy dashboard. 2500 is ~5x that, and a regression to
 * notify-always would put every active processor's whole consumer set on every
 * frame and blow it.
 */
export const PROCESSOR_NOTIFY_BUDGET = new PerfBudget({
  name: "Processor notifications/sec",
  threshold: 2500,
  windowMs: 1000,
  unit: "notifications",
});

setProcessorNotificationRecorder(() => PROCESSOR_NOTIFY_BUDGET.record());
