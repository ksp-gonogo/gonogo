import { setProcessorEvaluationRecorder } from "@ksp-gonogo/sitrep-client";
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
