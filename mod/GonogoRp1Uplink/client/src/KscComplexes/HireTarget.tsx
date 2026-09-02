import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Cluster,
  CommandButton,
  Disclosure,
  magnitudeOf,
  NULL_DISPLAY,
  Row,
  RowName,
  Stack,
  Switch,
  Text,
  Unit,
  UnitInput,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import type {
  Rp1ComplexEntry,
  Rp1HireTarget,
  Rp1Personnel,
} from "../__generated__/contract";

/** Stand up a hire instruction. Must match `Rp1TargetCommands.SetHireCommand`. */
export const RP1_HIRE_TARGET_SET_COMMAND = "rp1.hireTarget.set";

/** Withdraw it. Must match `Rp1TargetCommands.CancelHireCommand`. */
export const RP1_HIRE_TARGET_CANCEL_COMMAND = "rp1.hireTarget.cancel";

/**
 * The career's standing hire instruction: keep hiring until the staff reaches a
 * number, and never spend below a reserve.
 *
 * <para><b>Nothing is charged at the press, and no affordability verdict belongs
 * here.</b> Read on the shipped RP-1 v4.6.0.0 RP0.dll:
 * <c>HireStaffProject.IncrementProgress</c> runs every tick and hires
 * <c>min(applicants + (funds - reserve) / perHire, left)</c>, so a career that
 * cannot pay for the whole target hires what it can and comes back for the rest.
 * A short balance SLOWS the instruction; it never refuses it. What the operator
 * needs is therefore the BOUND on the spend rather than a yes or no, and the
 * bound is exact: hiring stops at the reserve, so it can draw at most the
 * balance minus the reserve.</para>
 *
 * <para><b>The reserve is the whole reason a standing order is safe to give</b>,
 * and it is the operator's number rather than RP-1's. Without one the career
 * would buy staff until the money ran out, which is why the command refuses an
 * instruction that omits it and why the field is not optional here.</para>
 *
 * <para><b>One instruction per career, so set and cancel are one control.</b>
 * RP-1 keeps a single <c>staffTarget</c>; a second one silently discards the
 * first. So whichever of the two is the legal move is the one drawn, and the
 * form is never offered beside the target it would overwrite.</para>
 *
 * <para><b>The kind is the absence of a complex, not a field.</b> RP-1 stores no
 * flag saying whether an instruction hires researchers or engineers: it names a
 * launch complex, or it does not. So the picker sends <c>lcId</c> or omits
 * it.</para>
 *
 * <para><b>Absent, not empty, on a save with no funding.</b> Hiring is a funds
 * mechanic bounded by a funds reserve, and a sandbox career has neither, so
 * asking an operator to bound a spend that cannot happen is worse than not
 * offering the control.</para>
 */
export function HireTargetControl({
  cancel,
  complexes,
  funds,
  personnel,
  set,
}: Readonly<{
  cancel: Parameters<typeof CommandButton>[0]["handle"];
  /** Every complex in the career, for the engineer half's picker. */
  complexes: readonly Rp1ComplexEntry[];
  /** The career balance. Null takes the whole control off, see the summary. */
  funds: number | null;
  personnel: Rp1Personnel | undefined;
  set: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  const target = personnel?.hireTarget;

  if (target?.active === true) {
    return (
      <StandingTarget complexes={complexes} handle={cancel} target={target} />
    );
  }

  if (funds === null) {
    return null;
  }

  return (
    <HireTargetForm
      complexes={complexes}
      funds={funds}
      handle={set}
      personnel={personnel}
    />
  );
}

/**
 * What stands: the headcount being reached, how many are left, and RP-1's own
 * forecast of when the funds for them will exist.
 *
 * <para>No arm-then-confirm on the cancel. <c>HireStaffProject.Clear()</c> zeroes
 * three fields and drops the complex reference, spends nothing, and is undone by
 * setting the target again.</para>
 */
function StandingTarget({
  complexes,
  handle,
  target,
}: Readonly<{
  complexes: readonly Rp1ComplexEntry[];
  handle: Parameters<typeof CommandButton>[0]["handle"];
  target: Rp1HireTarget;
}>) {
  const at = complexes.find((complex) => complex.lcId === target.lcId);
  const kind = target.isResearch === true ? "researchers" : "engineers";
  const where = at?.name == null ? "" : ` at ${at.name}`;

  return (
    <Stack gap="xs">
      <Row as="div">
        <RowName>
          Hiring to {kind}
          {where}
        </RowName>
        <Text size="xs">
          <Unit value={target.targetCount} /> ·{" "}
          <Unit value={target.leftToHire} /> left
          {target.timeLeft != null && (
            <>
              {" · "}
              <Unit value={target.timeLeft} /> away
            </>
          )}
        </Text>
      </Row>
      <Row as="div">
        <CommandButton
          args={{}}
          aria-label="Cancel the hire target"
          commandLabel="Cancel the hire target"
          handle={handle}
          label="Cancel"
          size="sm"
        />
      </Row>
    </Stack>
  );
}

/**
 * The form, and the two arms RP-1 applies to what it produces.
 *
 * <para>The first arm has words and is repeated here rather than left to the
 * dispatch: RP-1 refuses a target at or below the count it is measured against,
 * saying so, and a press that could only ever come back refused is a press worth
 * darkening. The second is a SILENT clamp against a complex's maximum engineers,
 * so it is disclosed instead of enforced: the command replicates RP-1's clamp,
 * and the honest thing to do about a number the game will quietly change is to
 * say so before the press rather than to alter what the operator typed.</para>
 */
function HireTargetForm({
  complexes,
  funds,
  handle,
  personnel,
}: Readonly<{
  complexes: readonly Rp1ComplexEntry[];
  funds: number;
  handle: Parameters<typeof CommandButton>[0]["handle"];
  personnel: Rp1Personnel | undefined;
}>) {
  const [lcId, setLcId] = useState<string | null>(null);
  const [wanted, setWanted] = useState(value("count", 0));
  const [reserve, setReserve] = useState(value("funds", 0));

  const staffable = complexes.filter(
    (complex) => complex.lcId != null && complex.isOperational === true,
  );
  const at = staffable.find((complex) => complex.lcId === lcId);
  const kind = at === undefined ? "researchers" : "engineers";
  const where = at?.name == null ? "" : ` at ${at.name}`;

  const current =
    at === undefined
      ? magnitudeOf(personnel?.researchers)
      : magnitudeOf(at.engineers);
  const ceiling = at === undefined ? null : magnitudeOf(at.maxEngineers);
  const targetCount = Math.round(magnitudeOf(wanted) ?? 0);
  const reserveFunds = magnitudeOf(reserve) ?? 0;

  // Only once a headcount has actually been entered. At the form's opening zero
  // the refusal is true and useless: it would greet every operator with RP-1's
  // complaint about a number they have not typed yet.
  const tooLow = current !== null && targetCount > 0 && targetCount <= current;
  const clamped = ceiling !== null && targetCount > ceiling;
  const spendable = Math.max(0, funds - reserveFunds);
  const press = `Hire up to ${targetCount} ${kind}${where}, spending no lower than ${reserveFunds.toLocaleString("en-GB")} funds`;

  return (
    <Disclosure
      ariaLabel="Set a hire target"
      asButton
      buttonSize="sm"
      chevron={false}
      label={(open: boolean) => (open ? "Hide hire target" : "Set hire target")}
      panelHeight="auto"
      variant="inline"
    >
      <Stack gap="sm">
        {/*
          Researchers first, because a career hires them from the moment it has an
          R&D building and the engineer half needs a complex that exists.
        */}
        {/*
          `Switch` rather than a row of toggle buttons, matching the centre picker
          in `NewComplexControl`. A toggle button carries the better semantics for
          an exclusive choice, and a render settled it anyway: `ActionButton` has
          one appearance, so `aria-pressed` moved and nothing on screen did, and
          an operator could not see which half the form was on.
        */}
        <Cluster gap="xs" wrap>
          <Switch
            checked={at === undefined}
            label="researchers"
            onChange={() => setLcId(null)}
          />
          {staffable.map((complex) => (
            <Switch
              checked={complex.lcId === lcId}
              key={complex.lcId}
              label={complex.name ?? NULL_DISPLAY}
              onChange={() => setLcId(complex.lcId ?? null)}
            />
          ))}
        </Cluster>

        <Row as="div">
          <RowName>{kind} now</RowName>
          <Text size="xs">
            {current === null ? (
              NULL_DISPLAY
            ) : (
              <Unit value={value("count", current)} />
            )}
            {ceiling !== null && (
              <>
                {" / "}
                <Unit value={value("count", ceiling)} /> max
              </>
            )}
          </Text>
        </Row>

        <UnitInput
          label="Target headcount"
          onChange={setWanted}
          unit="count"
          value={wanted}
        />
        {tooLow && (
          <Text size="xs" tone="warn">
            Staff count must be greater than the existing amount!
          </Text>
        )}
        {clamped && (
          <Text size="xs" tone="warn">
            above {at?.name ?? NULL_DISPLAY}'s maximum, so RP-1 will hold it at{" "}
            <Unit value={value("count", ceiling ?? 0)} />
          </Text>
        )}

        <UnitInput
          label="Reserve"
          onChange={setReserve}
          unit="funds"
          value={reserve}
        />

        <Row as="div">
          {/*
            The BOUND on the spend, not a verdict on it. Nothing is charged at the
            press and a short balance slows the instruction rather than refusing
            it, so the honest figure is what hiring can draw before it stops.
          */}
          <Text size="xs" tone="muted">
            draws at most{" "}
            <Unit value={value("funds", spendable)} decimals={0} /> of{" "}
            <Unit value={value("funds", funds)} decimals={0} />
          </Text>
          <CommandButton
            args={
              at === undefined
                ? { reserveFunds, targetCount }
                : { lcId: at.lcId ?? "", reserveFunds, targetCount }
            }
            aria-label={press}
            commandLabel={press}
            confirmAriaLabel={`Confirm hiring up to ${targetCount} ${kind}${where}`}
            confirmLabel="Confirm"
            disabled={targetCount <= 0 || tooLow}
            handle={handle}
            label="Set"
            size="sm"
          />
        </Row>
      </Stack>
    </Disclosure>
  );
}
