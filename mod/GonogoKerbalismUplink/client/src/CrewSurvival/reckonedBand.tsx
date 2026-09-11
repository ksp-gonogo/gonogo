import type {
  Reckoning,
  SlotProps,
  TopicPayload,
  UncertaintyBand,
} from "@ksp-gonogo/sitrep-sdk";
import {
  bandFor,
  bandIn,
  registerAugment,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import { Band, Inline, ReadoutCaption, Text } from "@ksp-gonogo/ui-kit";
// Side-effect: registers the model whose output this augment IS. A module that
// draws bands and can load without the thing that mints them renders an empty
// row and reports success, which is the one failure mode here nothing else
// would catch. `index.ts` loads it too, for the declaration-emit reason its own
// header gives; this one is about not being loadable in a state that draws
// nothing.
import "../crewReckoning";
import { KERBALISM_CREW_TOPIC } from "../topics";
import { KERBALISM } from "../uplink";
import { ruleLabel } from "./meters";

/**
 * How well the crew model knows the accumulator it just carried forward, on
 * the row of the kerbal it is about.
 *
 * ## Why this reads the Topic and not the Processor
 *
 * Every other surface in this folder reads `CREW_SURVIVAL`, and that Processor
 * is the right shape for all of them: it joins `vessel.crew`'s roster against
 * `kerbalism.crew`, flattens each rule to a 0..1 `fraction`, and hands three
 * consumers one derivation. What it cannot carry is the UNCERTAINTY, because a
 * fraction is a number and a band is an interval, and the Processor's own
 * output type has nowhere to put the second end.
 *
 * So this is the one surface that reads `kerbalism.crew` directly. It is also
 * the only reason `crewReckoning.ts`'s `bandAt` reaches a screen at all: that
 * model mints a real `sigma1` interval per moving accumulator, and until this
 * augment existed the whole of it was flattened away one layer downstream.
 *
 * ## Where the value it bounds is
 *
 * Directly below, on the same row: `./meters` contributes one `Meter` per rule
 * per kerbal into `crew-status.meters`, and `<WidgetMeters row={name}>` draws
 * them under the name this augment sits beside. The midpoint is deliberately
 * NOT redrawn here, for the reason `Band`'s own doc gives for rendering two
 * ends and never one figure: an interval collapsed to its centre answers a
 * question nobody asked, and a centre printed beside its own interval is the
 * same answer twice.
 *
 * ## When it draws nothing
 *
 * Most of the time, and that is the honest majority rather than a failure.
 * `reckonCrewAccumulators` offers a band only for an accumulator it has
 * WATCHED move, over at least three samples: a flat pair says the rule's input
 * resource is still aboard and there is no rate to be uncertain about, and a
 * straight line through exactly two points has zero residual and `n - 2`
 * degrees of freedom, so its standard error is `0/0` and the model answers
 * with none. A band invented for either case would be a claim the arithmetic
 * never made, so an absent band renders an absent readout and not a zero-width
 * one.
 */

type Crew = TopicPayload<typeof KERBALISM_CREW_TOPIC>;

/** One rule whose carried accumulator the model is prepared to bound. */
export interface BandedRule {
  /** The same label `./meters` puts on this rule's bar, so the two never drift. */
  label: string;
  band: UncertaintyBand<"units">;
}

/**
 * Which of this kerbal's rules carry a band, in the order the wire lists them.
 *
 * Exported and pure, the same shape `survivalMeters` and `survivalBadges` are
 * exported in: a test drives it against a plain `Reckoning` without mounting a
 * roster or reaching the augment registry.
 */
export function bandedRulesFor(
  reckoned: Reckoning<Crew>,
  crewName: string,
  crewIndex: number,
): BandedRule[] {
  const carried = reckoned.value;
  const kerbal = kerbalIndexFor(carried, crewName, crewIndex);
  if (kerbal === null) return [];
  const rules = carried[kerbal].rules ?? [];
  const banded: BandedRule[] = [];
  rules.forEach((rule, index) => {
    if (rule.name == null) return;
    /*
     * The path vocabulary is the model's, read back verbatim: `bandAt` keys
     * each interval by `${kerbal}.rules.${index}.value`, dotted from the
     * payload root the same way `modelled` names what it moved. Nothing in the
     * type system joins the two, so getting this wrong draws no band and
     * reports nothing, which is why `bandedRulesFor` is asserted against the
     * model's own `modelled` list rather than against a hand-written path.
     */
    const band = bandIn(
      bandFor(reckoned, `${kerbal}.rules.${index}.value`),
      "units",
    );
    if (!band) return;
    banded.push({ label: ruleLabel(rule.name), band });
  });
  return banded;
}

/**
 * This roster row's position in `kerbalism.crew`, or `null` for a kerbal the
 * Kerbalism wire says nothing about.
 *
 * `crewIndex` is a position in `vessel.crew.crew`, which is a DIFFERENT array
 * from the one the band paths index into, so it can only ever be a tiebreak:
 * the two agree in practice because the mod builds its roster from the same
 * seats, and the name is the join that stays true when they do not. That is
 * the same order `findKerbal` settles on next door, for the same reason, and a
 * duplicate name (legal in KSP) resolves to the seat whose position matches
 * rather than to whichever copy came first.
 */
function kerbalIndexFor(
  carried: Crew,
  crewName: string,
  crewIndex: number,
): number | null {
  if (carried[crewIndex]?.name === crewName) return crewIndex;
  const byName = carried.findIndex((entry) => entry.name === crewName);
  return byName === -1 ? null : byName;
}

/**
 * What the interval CLAIMS, spelled out rather than implied by its width.
 *
 * A hard bound and a standard error are different statements about the same
 * two numbers, and this model mints the weaker one: the true value sits
 * outside a one-sigma interval about a third of the time. An operator reading
 * "46.8 – 47.6" with nothing beside it would take it for a range the value is
 * inside, which is the stronger claim the model declined to make.
 */
const SIGMA1_CLAIM =
  "one standard deviation of the fitted rate, so the true value is outside " +
  "this interval about a third of the time";

function CrewSurvivalBandAugment({
  crewName,
  crewIndex,
}: SlotProps<"crew-status.row-badges">) {
  const reading = useTelemetry(KERBALISM_CREW_TOPIC);
  /*
   * The model is the whole subject here, so there is nothing to draw from an
   * observation alone: a reading with no reckoning on offer has no interval,
   * and the meters below already show where the accumulator was.
   */
  if (reading.reckoning !== "available") return null;
  const banded = bandedRulesFor(reading.reckoned, crewName, crewIndex);
  if (banded.length === 0) return null;
  return (
    <Inline gap="md" wrap>
      {banded.map(({ label, band }) => (
        /*
         * The `Text` is a SIZE context, not decoration: `Unit` sizes its
         * symbol in `em`, so putting the interval on the caption's own step is
         * what keeps it reading as a footnote to the meter below rather than
         * as a second headline next to the kerbal's name.
         */
        <Text
          key={label}
          size="xs"
          tone="muted"
          title={`${label}: ${SIGMA1_CLAIM}`}
        >
          <Inline gap="xs">
            <ReadoutCaption>{label}</ReadoutCaption>
            <Band min={band.lo} max={band.hi} />
          </Inline>
        </Text>
      ))}
    </Inline>
  );
}

registerAugment({
  id: "crew-survival-reckoned-band",
  augments: "crew-status.row-badges",
  component: CrewSurvivalBandAugment,
  channels: [KERBALISM_CREW_TOPIC],
  requires: "kerbalism",
  // After the consequence badge from `./index`, which states what is about to
  // happen to this kerbal. How well the model knows a number is the footnote
  // to that, never the headline.
  priority: 10,
  owner: KERBALISM,
});

export { CrewSurvivalBandAugment, SIGMA1_CLAIM };
