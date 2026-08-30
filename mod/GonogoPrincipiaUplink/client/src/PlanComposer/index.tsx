import type {
  ComposedBurn,
  PlanDraft,
  Reading,
  UseCommandResult,
} from "@ksp-gonogo/sitrep-sdk";
import {
  draftAsPlan,
  ManeuverFrame,
  observedAt,
  registerAugment,
  usePlanDrafts,
  useSendPlan,
  useTelemetry,
  useViewUt,
  type Value,
  type VesselIdentity,
  value,
  vectorMagnitude,
  withoutReckoning,
} from "@ksp-gonogo/sitrep-sdk";
import {
  CommandButton,
  Countdown,
  FieldLabel,
  MissionDate,
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
import { commandWindow, seededIgnitionUt } from "../commandWindow";
import { PRINCIPIA } from "../uplink";

/**
 * Compose a flight plan here and send it whole.
 *
 * <p><b>Why this sits beside the burn editor rather than replacing it.</b> The
 * editor changes the plan the vessel is ALREADY flying, one burn at a time, and
 * each change is its own message. This builds a plan that does not exist yet and
 * sends it as ONE: five separate burn commands are five light-times, each able
 * to arrive late, out of order or not at all, and a vessel that received three of
 * them would fly a trajectory nobody composed and nobody approved.</p>
 *
 * <p><b>Nothing here touches the vessel until Upload.</b> Drafts are
 * command-centre objects, so two operators can work on different plans for the
 * same vessel without disturbing each other or the player at the keyboard.</p>
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
  const viewUt = useViewUt();
  // Which draft the one outcome belongs to. The send handle is shared across
  // every draft, so without this an answer renders under all of them.
  const [sent, setSent] = useState<string | null>(null);
  /*
   * The send is a command like any other, so its schedule belongs on the
   * panel's delay rail: at a light-delayed vantage an operator has to be able to
   * see when the plan will actually reach the vessel.
   */
  usePanelDelay(send.command);

  if (vesselId === undefined || seenAt === undefined) {
    return (
      <Section>
        <SectionTitle>Compose a plan</SectionTitle>
        <Text tone="faint" size="sm">
          No vessel is being read, so there is nothing to plan for.
        </Text>
      </Section>
    );
  }

  const mine = drafts.filter((draft) => draft.vesselId === vesselId);

  /*
   * A new observation instant every time, because editing a plan is deciding
   * again: carrying the old one forward would date the new decision by the old
   * one's information.
   */
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

  const composing = mine.filter((draft) => draft.saved !== true);
  const ready = mine.filter((draft) => draft.saved === true);

  return (
    <>
      <Section>
        <SectionTitle>Ready to upload</SectionTitle>
        <Stack gap="sm">
          {ready.length === 0 ? (
            <Text tone="faint" size="sm">
              Nothing saved. A plan reaches the vessel only from here.
            </Text>
          ) : null}
          {ready.map((draft, index) => (
            <ReadyPlan
              key={draft.id}
              draft={draft}
              ordinal={index + 1}
              viewUt={viewUt?.magnitude ?? null}
              command={send.command}
              oneWaySeconds={send.command.effectiveDelaySeconds}
              pending={send.pending}
              outcome={sent === draft.id ? send.outcome : null}
              onReopen={() => store.update(draft.id, { saved: false })}
              onSend={() => {
                setSent(draft.id);
                return send.send(draftAsPlan(draft));
              }}
            />
          ))}
        </Stack>
      </Section>

      <Section>
        <SectionTitle>Composing</SectionTitle>
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

          {composing.length === 0 ? (
            <Text tone="faint" size="sm">
              Nothing being composed.
            </Text>
          ) : null}

          {composing.map((draft, planIndex) => (
            <Stack gap="xs" key={draft.id}>
              <Row>
                {/* A sequence position, not a name. Nothing edits it and nothing
                  sends it: the vessel has no use for what a draft was called. */}
                <RowName>Draft {planIndex + 1}</RowName>
              </Row>

              {draft.burns.map((burn, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: position IS a burn's identity in a plan; two burns can share an instant and every other field
                <Stack gap="xs" key={`${draft.id}-${index}`}>
                  <FieldLabel>Burn {index + 1}</FieldLabel>
                  {/* A minute a notch, and a minute a second held over: the
                    transfer-finding loop is nudging an ignition a few minutes
                    and reading what happens, and the wheel is that gesture where
                    the calendar fields beside it are for an instant already
                    known. */}
                  <UnitInput
                    label="Ignition"
                    unit="ut"
                    value={burn.ignitionUt}
                    rate={{ step: 60, stepsPerSecond: 60 }}
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
                      seededIgnitionUt(
                        draft.burns.length === 0
                          ? null
                          : draft.burns[draft.burns.length - 1].ignitionUt,
                        viewUt ?? seenAt,
                        send.command.effectiveDelaySeconds,
                      ),
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

              {/* Saving is the end of composing. Nothing leaves here: the draft
                goes to the list below, where transmitting it is a separate,
                deliberate act. Two surfaces rather than one button, so the
                difference between "written down" and "aboard a vessel" is
                visible rather than something an operator has to remember. */}
              <PrimaryButton
                onClick={() => store.update(draft.id, { saved: true })}
              >
                Save draft
              </PrimaryButton>
            </Stack>
          ))}
        </Stack>
      </Section>
    </>
  );
}

/**
 * One saved plan, and whether it can still get where it is going.
 *
 * <p>The verdict is the point of this row. A plan whose first burn is closer
 * than the round trip cannot be flown from here however healthy the link looks:
 * the press leaves at a view instant already one light time old, spends another
 * in flight, and lands after the burn should have lit. Saying so before the
 * press is the difference between an operator knowing that and believing they
 * acted.</p>
 */
function ReadyPlan({
  draft,
  ordinal,
  viewUt,
  command,
  oneWaySeconds,
  pending,
  outcome,
  onSend,
  onReopen,
}: Readonly<{
  draft: PlanDraft;
  ordinal: number;
  viewUt: number | null;
  /** The send's own dispatch, for the delay state the armed control renders. */
  command: UseCommandResult;
  oneWaySeconds: number;
  pending: boolean;
  outcome: { accepted: boolean; refusal?: string } | null;
  onSend: () => Promise<{ accepted: boolean; refusal?: string }>;
  onReopen: () => void;
}>) {
  const first = draft.burns[0];
  const window = commandWindow(
    first ? first.ignitionUt.magnitude : null,
    viewUt,
    oneWaySeconds,
  );

  /**
   * The send, in the shape the kit's command control takes.
   *
   * <p>The dispatch is the shared one and the args are already built by the send
   * handle, so this contributes only the press. A REFUSAL is re-thrown, because
   * the handle resolves on one: the control settles on its own promise, and a
   * resolved refusal would leave the button reading as though the plan went. The
   * sentence itself stays on the status line below, which is where a refusal has
   * room to say which of the three ways it failed.</p>
   */
  const upload = {
    ...command,
    send: async () => {
      const answer = await onSend();
      if (!answer.accepted) {
        throw new Error(answer.refusal ?? "The vessel declined the plan.");
      }
      return answer;
    },
  };

  return (
    <Stack gap="xs">
      <Row>
        <RowName>Plan {ordinal}</RowName>
        <Unit value={totalDeltaV(draft)} />
      </Row>

      {first ? (
        <Row>
          <RowName>First burn</RowName>
          <MissionDate value={first.ignitionUt.magnitude} />
        </Row>
      ) : null}

      {/* Nothing at a vantage with no delay: there the deadline IS ignition and
          the instant above already says it. A second line reading the same
          number would train an operator to ignore it at the vantages where the
          two are an hour apart. */}
      {window ? (
        <Row>
          <RowName>{window.shut ? "Too late" : "Send within"}</RowName>
          {window.shut ? (
            <Text tone="warn" size="sm">
              arrives after ignition
            </Text>
          ) : (
            <Countdown value={window.remainingSeconds} />
          )}
        </Row>
      ) : null}

      {/* An EMPTY plan is sendable, deliberately: a plan with no burns is a
          meaningful instruction, it clears the vessel's. Only a window that has
          shut stops a send, because that one cannot arrive in time whatever it
          contains.

          Armed rather than firing on the press, and this is the control that
          most needs it in the whole Uplink: an upload REPLACES whatever the craft
          is flying with this, there is no undo from the operator's seat, and at a
          distant vantage the correction is another round trip behind. Every other
          write on this surface already arms. */}
      <CommandButton
        size="sm"
        tone="go"
        handle={upload}
        commandLabel="Upload the flight plan"
        label="Upload to vessel"
        confirmLabel="CONFIRM UPLOAD"
        confirmTone="nogo"
        pendingLabel="Uploading..."
        disabled={pending || window?.shut === true}
        aria-label="Upload this flight plan to the vessel"
        confirmAriaLabel="Confirm uploading this flight plan to the vessel"
      />
      <PrimaryButton onClick={onReopen}>Reopen</PrimaryButton>

      {outcome === null ? null : (
        <Text
          role="status"
          tone={outcome.accepted ? "default" : "warn"}
          size="sm"
        >
          {outcome.accepted
            ? "Aboard. The vessel is flying this plan."
            : outcome.refusal}
        </Text>
      )}
    </Stack>
  );
}

/**
 * What the whole draft costs, as one number.
 *
 * <p>Per burn it is the magnitude of the three components, and those add across
 * burns rather than combining: a plan's cost is what the vessel must actually
 * spend, and two burns in opposite directions cost the sum of both, not their
 * difference.</p>
 */
function totalDeltaV(draft: PlanDraft): Value<"m/s"> {
  /*
   * Through the algebra rather than by hand: `vectorMagnitude` is the same
   * hypotenuse every other three-component read takes, and doing it here with
   * raw magnitudes would be a second implementation free to disagree with it.
   */
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
 * plan can still reach, and three components the operator has not typed.
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
 * The vessel's id when one has been read.
 *
 * <p>A stale identity still names the vessel: which vessel this is does not stop
 * being true because the link went quiet, and refusing to plan for a vessel whose
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
