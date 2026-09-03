import type { SlotProps } from "@ksp-gonogo/sitrep-sdk";
import { registerAugment, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import { Badge } from "@ksp-gonogo/ui-kit";
import { current } from "../shared/current";
import { RP1 } from "../uplink";
import "../topics";
import { kindOf } from "./template";

/**
 * Whether this kerbal is on a course, in the corner of the card the Astronaut
 * Complex draws for them.
 *
 * <para><b>Why the corner and not the schedule underneath.</b> A kerbal RP-1 has
 * on a training course still reads `Available` to KSP's own roster, so the
 * Astronaut Complex files them under Available beside everybody who could fly
 * tomorrow, and nothing in the identity line says otherwise. The mark used to
 * ride the "Course" line in the block below, which is the right place for WHICH
 * course and the wrong place for the fact THAT there is one: the block is read
 * once an operator has settled on a kerbal, and this is the fact that decides
 * which kerbal they settle on. Scanning six cards for a free crew, the corner is
 * what is read and the block is what is skipped.</para>
 *
 * <para><b>Enrolled is not training, and the corner keeps them apart.</b> RP-1
 * builds a course and leaves it unstarted until it has its students, and a
 * course can sit that way indefinitely. A kerbal marked as training who is not
 * being trained is the reading that costs a flight, so the mark says which of
 * the two it is rather than saying "busy" for both.</para>
 *
 * <para>Nothing on a stock game, nothing for a kerbal RP-1 is not scheduling,
 * and nothing for one who is on no course: an empty corner is the normal state
 * of most cards on most careers, and a grey "no course" chip on every one of
 * them would spend the corner on the answer nobody is looking for.</para>
 */
export function CrewTrainingBadge({
  kerbalName,
}: Readonly<SlotProps<"astronaut-complex.crew-badge">>) {
  const available = current(useTelemetry("rp1.available"));
  const crew = current(useTelemetry("rp1.crew"));

  if (available !== true) {
    return null;
  }
  /* Narrowed rather than trusted, for the reason CrewSchedule's is: the slot's
     props type is the loose record out here, and an absent name must not match
     the first row with a null one. */
  const name = typeof kerbalName === "string" ? kerbalName : "";
  if (name === "") {
    return null;
  }
  const row = (crew ?? []).find((c) => c.name === name);
  const target = row?.trainingTarget ?? row?.trainingCourse;
  if (!row || !target) {
    return null;
  }

  const started = row.trainingStarted === true;
  // WHICH course on the hover, because the corner has room for the fact and not
  // for the name. The line that carries the name in full is still there in the
  // block below; this is the pointer's shortcut to it, not a second copy.
  const kind = kindOf(row.trainingType);
  return (
    <Badge
      severity={started ? "nominal" : "caution"}
      size="sm"
      title={kind === null ? target : `${kind}: ${target}`}
    >
      {started ? "TRAINING" : "ENROLLED"}
    </Badge>
  );
}

registerAugment({
  id: "rp1-crew-training-badge",
  augments: "astronaut-complex.crew-badge",
  channels: ["rp1.available", "rp1.crew"],
  component: CrewTrainingBadge,
  owner: RP1,
});
