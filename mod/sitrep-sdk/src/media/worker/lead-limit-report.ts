import type { FrameDelayPipeline } from "../frame-delay";
import { DEFAULT_PACING_MAX_LEAD_SECONDS } from "../frame-delay";

/**
 * A pacing tick for `pipeline` that also calls `post` with its lead limit when
 * the tick moved it, so the main thread can read it without the worker keeping
 * a timer for it. The figure the main thread starts from is
 * {@link DEFAULT_PACING_MAX_LEAD_SECONDS}, so nothing is posted until it differs.
 */
export function tickReportingLeadLimit(
  pipelineId: string,
  pipeline: Pick<FrameDelayPipeline, "tickPacing" | "leadLimitSeconds">,
  post: (message: {
    type: "pipelineLeadLimit";
    pipelineId: string;
    seconds: number;
  }) => void,
): (nowWall: number) => void {
  let reported = DEFAULT_PACING_MAX_LEAD_SECONDS;
  return (nowWall) => {
    pipeline.tickPacing(nowWall);
    const seconds = pipeline.leadLimitSeconds();
    if (seconds === reported) return;
    reported = seconds;
    post({ type: "pipelineLeadLimit", pipelineId, seconds });
  };
}
