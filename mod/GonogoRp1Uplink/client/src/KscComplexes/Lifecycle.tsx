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
 * Demolishing a launch complex.
 *
 * <para><b>The warning is ON THE PRESS, not on the card.</b> It used to be three
 * sentences standing permanently under every complex, explaining what an
 * efficiency record is and what happens to it. The operator's ruling: "this is
 * meant to be a mission control, not a storybook. We present facts and
 * instrumentation, not guidance." A standing explanation of a button nobody has
 * pressed is guidance, and it was repeated on every complex in the career.</para>
 *
 * <para>So the whole of it is now the confirm step's own label, in the operator's
 * own words. What is lost is the distinction between a crew rating that dies with
 * the complex and one that survives in a sibling; what is kept is the fact that a
 * crew rating goes at all, which is the half RP-1's own dialog never mentions. The
 * sibling case is still on the wire as `efficiencySharedWith` for anything that
 * wants it.</para>
 *
 * <para>Arm then confirm, because it is not reversible: a rebuilt complex starts
 * its crew rating again from RP-1's floor.</para>
 */
export function DismantleControl({
  complex,
  name,
  handle,
}: Readonly<{
  complex: Rp1ComplexEntry;
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

  return (
    <CommandButton
      args={{ lcId }}
      aria-label={`Dismantle ${name}`}
      commandLabel={`Dismantle ${name}`}
      confirmAriaLabel={`Confirm dismantling ${name}: removes the whole complex, its pads and its crew rating`}
      confirmLabel="Warning: removes complex, pads and crew rating"
      confirmTone="nogo"
      handle={handle}
      label="Dismantle"
      size="sm"
      tone="warn"
    />
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
