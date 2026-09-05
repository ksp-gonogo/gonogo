import {
  defineProcessor,
  type ReckonerFor,
  registerReckoner,
} from "@ksp-gonogo/sitrep-client";
import type { TopicPayload } from "@ksp-gonogo/sitrep-sdk";

type VesselTarget = TopicPayload<"vessel.target">;

/**
 * The frame-memoised evaluation the reckoning will run once it exists.
 * **Stubbed: it computes nothing today, deliberately.**
 *
 * It is a real `defineProcessor` rather than a bare function because the seam is
 * the point. `useProcessor`/the evaluator ref-count activation and memoise per
 * frame, so a reckoning is paid for once per frame per topic actually read, and
 * not at all for topics nobody reads. Proving that path is wired is worth more
 * than proving a placeholder returns undefined.
 *
 * ## What it needs before it can be built, and cannot currently have
 *
 * Dead reckoning a relative position needs the last observed position and
 * velocity, the UT that observation was made at, and confirmation that we are
 * out of contact rather than merely delayed. Only the first is reachable here:
 * `defineProcessor` deps resolve to `TopicPayload<D> | undefined`, which is the
 * VALUE channel alone, so a processor can see neither a topic's status nor its
 * `validAt`.
 *
 * The reckoner below has all three, because it is handed the point, the grade
 * and the frame's view time. So the shape this wants is the processor doing the
 * arithmetic and the reckoner supplying the inputs, which is why both exist
 * rather than one. The remaining gap is a dep form that resolves to a
 * `Reading<T>`, or a processor-visible frame view time; flagged rather than
 * worked around, because working around it here would put a second clock in a
 * widget.
 */
export const targetReckoning = defineProcessor({
  id: "target-reckoning",
  owner: "targeting",
  deps: ["vessel.target"] as const,
  compute: (): { distanceM: number } | undefined => undefined,
});

/**
 * Whether a relative-position reckoning is available for `vessel.target`, and
 * the pull that produces it. **Stubbed: always declines**, so a target that goes
 * quiet reads `stale` and the widget renders no modelled figure.
 *
 * Declining is the honest answer while nothing can model the gap, and it is a
 * real statement rather than a placeholder: `reckoning: "available"` is what
 * tells a widget a number can be trusted, so a stub that offered one would make
 * the type lie in exactly the way the type exists to prevent.
 *
 * ## The horizon, when this is built
 *
 * Relative motion between an orbiting pair is curved, so advancing a relative
 * position by its last observed velocity is honest for seconds, not minutes.
 * This function's job is therefore to stop RETURNING a model past its own
 * horizon rather than to return one with a caveat attached, which is what the
 * `viewUt` argument is for: the elapsed window is `viewUt - point.validAt`. The
 * reading is rebuilt whenever the view time moves, so withdrawing is all it
 * takes: the topic reads `reckoning: "none"` from that frame on, keeping
 * whatever `state` it honestly has, and no caller can be holding a model that
 * has gone bad. That is why `Reading` carries no horizon field and `reckoned`
 * has no failure return.
 *
 * The other half of the horizon is a burn. A dead-reckoned position assumes
 * nothing has thrusted, and a craft out of contact is exactly a craft we cannot
 * know that about, so the honest horizon is short even where the geometry is
 * benign.
 */
const reckonTarget: ReckonerFor<VesselTarget> = () => undefined;

registerReckoner("vessel.target", "targeting", reckonTarget);
