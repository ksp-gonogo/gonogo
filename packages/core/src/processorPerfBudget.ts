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
 * It exists because the evaluation budget cannot see a notify regression. If
 * the evaluator compared results with `Object.is`, every processor would look
 * changed on every frame (they all allocate) and every consumer of every
 * processor would be woken whether or not a thing on the wire had moved, while
 * the evaluations themselves stayed correct and wanted and the eval budget
 * stayed green. Consolidating N re-derivations onto processors would then trade
 * N derivations for one derivation plus N wakeups, with nothing measuring the
 * second half. Recorded once per listener told, so the ratio against
 * PROCESSOR_EVAL_BUDGET is readable straight off the Perf Budgets widget.
 *
 * Threshold: steady state is only the processors whose answer really
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

/**
 * The third budget, re-exported rather than declared: it lives beside the
 * evaluator in the spine, not here.
 *
 * That is a deliberate break from the two above, and the reason is the one this
 * budget exists to serve. These two are wired core-side because `PerfBudget`
 * was core-side when they were written, and the cost of that is invisible from
 * here: the wiring runs in the app's test setup and in NO Uplink's, so all nine
 * Uplink suites call `PerfBudget.installTestGate()` and gate nothing about
 * processors. An Uplink author is the likeliest person to write the processor
 * that trips this, so a gate they cannot see is not a gate.
 *
 * Kept exported from this module so `Perf Budgets` and every existing importer
 * still finds all three processor budgets in one place.
 */
export { PROCESSOR_UNCOMPARABLE_BUDGET } from "@ksp-gonogo/sitrep-client";
