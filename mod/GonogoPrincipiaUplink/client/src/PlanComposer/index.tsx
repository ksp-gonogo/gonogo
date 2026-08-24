import type { ComposedBurn, PlanDraft, Reading } from "@ksp-gonogo/sitrep-sdk";
import {
  draftAsPlan,
  ManeuverFrame,
  observedAt,
  registerAugment,
  usePlanDrafts,
  useSendPlan,
  useTelemetry,
  type Value,
  type VesselIdentity,
  value,
  vectorMagnitude,
  withoutReckoning,
} from "@ksp-gonogo/sitrep-sdk";
import {
  FieldLabel,
  PrimaryButton,
  Row,
  RowName,
  Section,
  SectionTitle,
  Stack,
  Text,
  Unit,
  UnitInput,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import { PRINCIPIA } from "../uplink";

/**
 * Compose a flight plan here and send it whole.
 *
 * <p><b>Why this sits beside the burn editor rather than replacing it.</b> The
 * editor changes the plan the craft is ALREADY flying, one burn at a time, and
 * each change is its own message. This builds a plan that does not exist yet and
 * sends it as ONE: five separate burn commands are five light-times, each able
 * to arrive late, out of order or not at all, and a craft that received three of
 * them would fly a trajectory nobody composed and nobody approved.</p>
 *
 * <p><b>Nothing here touches the craft until Send.</b> Drafts are
 * command-centre objects, so two operators can work on different plans for the
 * same craft without disturbing each other or the player at the keyboard.</p>
 *
 * <p><b>The instant the draft was built from is stamped when it is built.</b> It
 * records how old the information was that the operator decided on, which is a
 * property of the moment they decided rather than of the moment they pressed
 * send. Under signal delay those are different instants, and the difference
 * between them is the whole of what makes the divergence measurable at the far
 * end.</p>
 */
export function PlanComposer() {
  const identity = withoutReckoning(useTelemetry("vessel.identity"));
  // Reckoning stripped before the instant is taken: what a plan records is when
  // the state it was built from was actually OBSERVED. A forward model's instant
  // is a moment nobody saw, and the divergence measured against it at the far
  // end would be measured against a fiction.
  const orbit = withoutReckoning(useTelemetry("vessel.orbit"));
  const vesselId = knownId(identity);
  const seenAt = observedAt(orbit);

  const { store, drafts } = usePlanDrafts();
  const send = useSendPlan();
  // Which draft the one outcome belongs to. The send handle is shared across
  // every draft, so without this an answer renders under all of them.
  const [sent, setSent] = useState<string | null>(null);
  // The send is a command like any other, so its schedule belongs on the
  // panel's delay rail: at a light-delayed vantage an operator has to be able to
  // see when the plan will actually reach the craft.
  usePanelDelay(send.command);

  if (vesselId === undefined || seenAt === undefined) {
    return (
      <Section>
        <SectionTitle>Compose a plan</SectionTitle>
        <Text tone="faint" size="sm">
          No craft is being read, so there is nothing to plan for.
        </Text>
      </Section>
    );
  }

  const mine = drafts.filter((draft) => draft.vesselId === vesselId);

  // A new observation instant every time, because editing a plan is deciding
  // again: carrying the old one forward would date the new decision by the old
  // one's information.
  const edit = (draft: PlanDraft, burns: ComposedBurn[]) =>
    store.update(draft.id, { burns, observedAt: seenAt });

  const setComponent = (
    draft: PlanDraft,
    index: number,
    changes: Partial<ComposedBurn>,
  ) => {
    const burns = draft.burns.slice();
    burns[index] = { ...burns[index], ...changes };
    edit(draft, burns);
  };

  return (
    <Section>
      <SectionTitle>Uplinked plans</SectionTitle>
      <Stack gap="sm">
        <PrimaryButton
          onClick={() =>
            store.create({
              name: `Plan ${mine.length + 1}`,
              vesselId,
              burns: [],
              observedAt: seenAt,
            })
          }
        >
          Draft plan
        </PrimaryButton>

        {mine.length === 0 ? (
          <Text tone="faint" size="sm">
            Nothing drafted. A draft stays here until it is uplinked.
          </Text>
        ) : null}

        {mine.map((draft, planIndex) => (
          <Stack gap="xs" key={draft.id}>
            <Row>
              {/* A sequence position, not a name. Nothing edits it and nothing
                  sends it: the craft has no use for what a draft was called. */}
              <RowName>Draft {planIndex + 1}</RowName>
            </Row>

            {draft.burns.map((burn, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: position IS a burn's identity in a plan; two burns can share an instant and every other field
              <Stack gap="xs" key={`${draft.id}-${index}`}>
                <FieldLabel>Burn {index + 1}</FieldLabel>
                <UnitInput
                  label="Ignition"
                  unit="ut"
                  value={burn.ignitionUt}
                  onChange={(next) =>
                    setComponent(draft, index, { ignitionUt: next })
                  }
                />
                {/* Slot order, not names. The three Δv slots carry the BASIS's
                    own components in its own order, and the basis this burn
                    declares is tangent, normal, binormal: so dvRadial is the
                    tangent and dvPrograde is the binormal. Labelling these by
                    their field names would put an operator's along-track burn
                    out of plane, which is a wrong burn that reads as a right
                    one. */}
                <UnitInput
                  label="Tangent"
                  unit="m/s"
                  value={burn.dvRadial}
                  onChange={(next) =>
                    setComponent(draft, index, { dvRadial: next })
                  }
                />
                <UnitInput
                  label="Normal"
                  unit="m/s"
                  value={burn.dvNormal}
                  onChange={(next) =>
                    setComponent(draft, index, { dvNormal: next })
                  }
                />
                <UnitInput
                  label="Binormal"
                  unit="m/s"
                  value={burn.dvPrograde}
                  onChange={(next) =>
                    setComponent(draft, index, { dvPrograde: next })
                  }
                />
              </Stack>
            ))}

            <PrimaryButton
              onClick={() =>
                edit(draft, [
                  ...draft.burns,
                  emptyBurn(
                    draft.burns.length === 0
                      ? seenAt
                      : draft.burns[draft.burns.length - 1].ignitionUt,
                  ),
                ])
              }
            >
              Add burn
            </PrimaryButton>

            <Row>
              <RowName>Total Δv</RowName>
              <Unit value={totalDeltaV(draft)} />
            </Row>

            <PrimaryButton
              disabled={send.pending}
              onClick={async () => {
                setSent(draft.id);
                // Awaited rather than dropped: the craft's answer is what the
                // status line renders, and a dispatch whose outcome is
                // discarded shows an operator nothing when the game refuses.
                await send.send(draftAsPlan(draft));
              }}
            >
              Uplink to craft
            </PrimaryButton>

            {/* Under the draft it answers, not at the foot of the panel. One
                handle serves every draft, so an outcome floating below them all
                says a plan was accepted without saying which. */}
            {sent === draft.id && send.outcome !== null ? (
              <Text
                role="status"
                tone={send.outcome.accepted ? "default" : "warn"}
                size="sm"
              >
                {send.outcome.accepted
                  ? "Aboard. The craft is flying this plan."
                  : send.outcome.refusal}
              </Text>
            ) : null}
          </Stack>
        ))}
      </Stack>
    </Section>
  );
}

/**
 * What the whole draft costs, as one number.
 *
 * <p>Per burn it is the magnitude of the three components, and those add across
 * burns rather than combining: a plan's cost is what the craft must actually
 * spend, and two burns in opposite directions cost the sum of both, not their
 * difference.</p>
 */
function totalDeltaV(draft: PlanDraft): Value<"m/s"> {
  // Through the algebra rather than by hand: `vectorMagnitude` is the same
  // hypotenuse every other three-component read takes, and doing it here with
  // raw magnitudes would be a second implementation free to disagree with it.
  return draft.burns.reduce(
    (sum, burn) =>
      sum.plus(
        vectorMagnitude({
          x: burn.dvRadial,
          y: burn.dvNormal,
          z: burn.dvPrograde,
        }),
      ),
    value("m/s", 0),
  );
}

/**
 * A burn with no Δv in it yet, which is what "add a burn" means: an instant the
 * operator has chosen and three components they have not.
 *
 * <p>Frenet, because the three numbers an operator types are along-track, normal
 * and radial. The same three in another frame would mean something else.</p>
 */
function emptyBurn(ignitionUt: Value<"ut">): ComposedBurn {
  return {
    ignitionUt,
    frame: ManeuverFrame.TangentNormalBinormal,
    dvPrograde: value("m/s", 0),
    dvNormal: value("m/s", 0),
    dvRadial: value("m/s", 0),
    inertiallyFixed: false,
  };
}

/**
 * The craft's id when one has been read.
 *
 * <p>A stale identity still names the craft: which craft this is does not stop
 * being true because the link went quiet, and refusing to plan for a craft whose
 * name is a minute old would make this useless at exactly the distances it is
 * for.</p>
 */
function knownId(reading: Reading<VesselIdentity>): string | undefined {
  if (reading.state === "observed" || reading.state === "stale") {
    return reading.value.vesselId;
  }
  return undefined;
}

registerAugment({
  id: "principia-plan-composer",
  augments: "maneuver-planner.sections",
  component: PlanComposer,
  owner: PRINCIPIA,
});
