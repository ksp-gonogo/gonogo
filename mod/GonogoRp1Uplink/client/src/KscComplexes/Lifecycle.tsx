import {
  CommandButton,
  Inline,
  magnitudeOf,
  NULL_DISPLAY,
  Row,
  Stack,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { Rp1ComplexEntry, Rp1PadEntry } from "../__generated__/contract";

/** Demolish a launch complex. Must match `Rp1ComplexLifecycleCommands.DismantleComplexCommand`. */
export const RP1_COMPLEX_DISMANTLE_COMMAND = "rp1.complex.dismantle";

/** Demolish one of a complex's pads. Must match `Rp1ComplexLifecycleCommands.DismantlePadCommand`. */
export const RP1_PAD_DISMANTLE_COMMAND = "rp1.pad.dismantle";

/**
 * Demolishing a launch complex, and what it costs that RP-1 does not say.
 *
 * <para><b>The whole point of this control is the sentence above it.</b> RP-1's
 * own confirmation reads "Are you sure you want to dismantle the currently
 * selected launch complex, X? This cannot be undone!" and names nothing that is
 * actually about to be lost. What is lost is the complex's EARNED BUILD
 * EFFICIENCY: RP-1 rates an efficiency record rather than a complex, and
 * demolishing the last complex on a record clears the record, so a complex
 * rebuilt to the same specification starts again from RP-1's floor and works its
 * way back up over months of career time.</para>
 *
 * <para>Whether that happens at all depends on something an operator cannot see
 * without being told: if another complex shares the record, the figure survives
 * in it and nothing is lost. Those are two different warnings and the wrong one
 * is worse than none, so the control says which. Both inputs are on the wire as
 * <c>efficiency</c> and <c>efficiencySharedWith</c>.</para>
 *
 * <para><b>Arm then confirm</b>, unlike the rush and assign controls beside it.
 * Those change a rate and are reversible by pressing again; this is not
 * reversible at all, which is the condition that earns a second press.</para>
 *
 * <para>It does NOT need a funds balance beside it. Demolishing spends nothing
 * and refunds nothing: the complex simply stops existing, and its structural
 * upkeep (which the card's own cost line carries) stops with it.</para>
 */
export function DismantleControl({
  complex,
  complexNames,
  name,
  handle,
}: Readonly<{
  complex: Rp1ComplexEntry;
  /** Every complex in the career by id, so a surviving peer can be named rather than numbered. */
  complexNames: ReadonlyMap<string, string>;
  name: string;
  handle: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  const lcId = complex.lcId;
  if (lcId === undefined || lcId === null) {
    return null;
  }

  // The one complex RP-1 will never demolish, and it says so itself. Drawing a
  // control that can only be refused would be worse than drawing none.
  if (complex.lcType === "Hangar") {
    return null;
  }

  const peers = (complex.efficiencySharedWith ?? []).map(
    (peer) => complexNames.get(peer) ?? peer,
  );
  const efficiency = magnitudeOf(complex.efficiency);
  const loses = peers.length === 0 && efficiency !== null && efficiency > 0;

  return (
    <Stack gap="xs">
      <EfficiencyWarning
        complex={complex}
        efficiency={efficiency}
        loses={loses}
        peers={peers}
      />
      <CommandButton
        args={{ lcId }}
        aria-label={
          loses
            ? `Dismantle ${name}, losing its crew rating for good`
            : `Dismantle ${name}`
        }
        commandLabel={`Dismantle ${name}`}
        confirmAriaLabel={
          loses
            ? `Confirm dismantling ${name} and losing its crew rating`
            : `Confirm dismantling ${name}`
        }
        confirmLabel="Confirm dismantle"
        confirmTone="nogo"
        handle={handle}
        label="Dismantle"
        size="sm"
        tone="warn"
      />
    </Stack>
  );
}

/**
 * Which of the two efficiency answers this complex is, in words.
 *
 * <para>Three cases rather than two, and the third matters as much as the other
 * two: a complex nobody has built at yet has no rating to lose, because RP-1
 * creates the record the first time work happens there. Saying "nothing to lose"
 * for that case is true and useful; saying it for a complex whose rating is
 * simply unreadable would not be, which is why an absent figure and a zero are
 * kept apart.</para>
 */
function EfficiencyWarning({
  complex,
  efficiency,
  loses,
  peers,
}: Readonly<{
  complex: Rp1ComplexEntry;
  efficiency: number | null;
  loses: boolean;
  peers: readonly string[];
}>) {
  if (efficiency === null) {
    return (
      <Text size="xs" tone="muted">
        dismantling removes the complex and every pad on it, and cannot be
        undone
      </Text>
    );
  }

  if (peers.length > 0) {
    return (
      <Text size="xs" tone="muted">
        dismantling removes the complex and every pad on it. Its{" "}
        <Unit value={complex.efficiency} /> crew rating survives with{" "}
        {peers.join(", ")}
      </Text>
    );
  }

  if (!loses) {
    return (
      <Text size="xs" tone="muted">
        dismantling removes the complex and every pad on it. Nothing has been
        built here yet, so there is no crew rating to lose
      </Text>
    );
  }

  return (
    <Text size="xs" tone="warn">
      dismantling removes the complex and every pad on it, and its{" "}
      <Unit value={complex.efficiency} /> crew rating is shared with nothing, so
      it is LOST for good. A rebuilt complex starts again from the bottom
    </Text>
  );
}

/**
 * Demolishing one pad, drawn on the pad's own row.
 *
 * <para><b>Why this is a refusal and not simply a control.</b> RP-1 will not let
 * a complex lose its last working pad, and the way it enforces that is to do
 * nothing: its check short-circuits, its confirmation dialog closes, and the pad
 * is still there with no message posted anywhere. So the control is dark with the
 * reason rather than live and silently inert, and the command refuses in words if
 * it is sent anyway.</para>
 *
 * <para>The count that matters is the OPERATIONAL one, which is why
 * <c>isOperational</c> is on the wire: a pad still under construction does not
 * count toward the one a complex must keep, and cannot itself be dismantled
 * because there is nothing built to remove.</para>
 */
export function PadDismantleControl({
  complex,
  pad,
  handle,
}: Readonly<{
  complex: Rp1ComplexEntry;
  pad: Rp1PadEntry;
  handle: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  const lcId = complex.lcId;
  const padId = pad.padId;
  if (
    lcId === undefined ||
    lcId === null ||
    padId === undefined ||
    padId === null
  ) {
    return null;
  }

  const padName = pad.name ?? NULL_DISPLAY;
  const operational = magnitudeOf(complex.launchPadCount);
  const inService = pad.isOperational === true;
  const last = operational !== null && operational < 2;

  // Two unrelated reasons a press is refused, and an operator who cannot press
  // needs to know which: build another pad, or wait for this one to finish.
  const blockedBecause = !inService
    ? `${padName} is not in service yet, so cancel its construction instead`
    : last
      ? `${padName} is the last working pad at this complex, and a complex must keep one`
      : null;

  return (
    <Inline gap="xs">
      <CommandButton
        args={{ lcId, padId }}
        aria-label={blockedBecause ?? `Dismantle ${padName}, permanently`}
        commandLabel={`Dismantle ${padName}`}
        confirmAriaLabel={`Confirm dismantling ${padName}`}
        confirmLabel="Confirm"
        confirmTone="nogo"
        disabled={blockedBecause !== null}
        handle={handle}
        label="Dismantle"
        size="sm"
        tone="warn"
      />
    </Inline>
  );
}

/**
 * A complex's pads as rows rather than a sentence, once any of them has a control
 * on it.
 *
 * <para>The list used to be one muted line naming every pad and its level, which
 * is right for a reading and wrong the moment a pad can be acted on: a press has
 * to sit beside the thing it acts on, and a row of names with buttons run
 * together reads as a row of buttons.</para>
 *
 * <para>The operational count is asked of RP-1 rather than counted off the rows,
 * and that is not laziness: a wrecked pad reports <c>Destroyed</c> rather than
 * non-operational, so counting what is not non-operational overcounts exactly
 * when a launch has just gone wrong. It is also the number RP-1's own rule is
 * stated against.</para>
 */
export function PadRows({
  complex,
  pads,
  dismantlePad,
}: Readonly<{
  complex: Rp1ComplexEntry;
  pads: readonly Rp1PadEntry[];
  dismantlePad: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  const operational = magnitudeOf(complex.launchPadCount);

  if (pads.length === 0) {
    return (
      <Text size="xs" tone="muted">
        no pads
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      <Text size="xs" tone="muted">
        pads · <Unit value={complex.launchPadCount} /> operational
        {operational !== null &&
          operational < 2 &&
          ", so none can be dismantled"}
      </Text>
      <Stack as="ul" gap="xs" style={LIST_STYLE}>
        {pads.map((pad, index) => (
          <Row key={pad.padId ?? pad.name ?? String(index)}>
            <Text size="xs">
              {pad.name ?? NULL_DISPLAY} at level <Unit value={pad.level} />
              {pad.isOperational === false && " · not in service"}
            </Text>
            <PadDismantleControl
              complex={complex}
              handle={dismantlePad}
              pad={pad}
            />
          </Row>
        ))}
      </Stack>
    </Stack>
  );
}

/**
 * A Cluster renders a `<li>` here, so its rows need list semantics around them;
 * see the host widget for the same reset and why it is inline.
 */
const LIST_STYLE = { listStyle: "none", margin: 0, padding: 0 } as const;
