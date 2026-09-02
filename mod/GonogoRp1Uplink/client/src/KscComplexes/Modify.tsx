import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  CommandButton,
  Disclosure,
  magnitudeOf,
  NULL_DISPLAY,
  Row,
  Stack,
  Switch,
  Text,
  Unit,
  UnitInput,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import type { Rp1ComplexEntry } from "../__generated__/contract";
import { type LcCurrent, type LcSpec, quoteModifyComplex } from "./lcCost";

/** Renovate a complex into a new envelope. Must match `Rp1ComplexConstructionCommands.ModifyComplexCommand`. */
export const RP1_COMPLEX_MODIFY_COMMAND = "rp1.complex.modify";

/**
 * Renovating a launch complex the career already has.
 *
 * <para><b>Nothing is spent at the press, so there is no affordability
 * verdict.</b> A construction under RP-1 is not a purchase: the project is added
 * to its queue and funds are drawn AS IT BUILDS, at a rate that falls when the
 * career is short. So a complex cannot overdraw a career, an up-front check
 * would refuse work RP-1 itself would happily start and simply run slowly, and a
 * balance that does not cover the quote is a pace problem. That is the same
 * reading `PadNewControl` and `NewComplexControl` state, in the same words.</para>
 *
 * <para><b>YOU PAY TO DOWNGRADE, and that is said out loud.</b> RP-1 charges half
 * the difference in both halves for a reduction, plus a floor of 1,000 funds for
 * any movement of the tonnage limit at all. An operator shrinking a complex is
 * the one most likely to expect money back, so the quote names the case rather
 * than leaving a bill to be discovered.</para>
 *
 * <para><b>IT TAKES THE COMPLEX'S WHOLE CREW OFF</b>, which is not a side effect
 * chosen here: RP-1 does <c>ChangeEngineers(lc, -lc.Engineers)</c> as the first
 * thing it does and pops a dialog saying so afterwards. The count is beside the
 * press instead, where it can still change the answer, and the toggle that puts
 * them back is next to it.</para>
 *
 * <para><b>The fluids are sent back unchanged, and the control does not offer to
 * edit them.</b> `Rp1ComplexModifyArgs.resources` is a SET and absent means NONE,
 * so a renovation that says nothing about them strips every one. Editing them
 * would need a price this wire does not carry for a renovation (the per-unit
 * figures on `rp1.lcPricing` are a PAD BUILD's, and there is no hangar twin at
 * all), and quoting a renovation under its true cost is worse than not offering
 * the field. So the current set goes back verbatim and the quote's resource half
 * is exactly zero.</para>
 *
 * <para>ABSENT when RP-1 has not said what the complex holds. Absent is not
 * empty: renovating on a guess of "no fluids" would strip whatever it actually
 * has.</para>
 */
export function ModifyControl({
  complex,
  funds,
  handle,
}: Readonly<{
  complex: Rp1ComplexEntry;
  /** The career balance, for the covers-it reading only. Absent means say nothing. */
  funds: number | null;
  handle: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  const lcId = complex.lcId;
  const capacities = complex.resourceCapacities;
  if (lcId == null || capacities == null || complex.isOperational !== true) {
    return null;
  }
  return (
    <ModifyForm
      capacities={capacities}
      complex={complex}
      funds={funds}
      handle={handle}
      lcId={lcId}
    />
  );
}

/**
 * The form, whose fields are the ones RP-1 draws for this kind of complex.
 *
 * <para>The hangar draws neither tonnage nor human rating, and that is enforced
 * by not rendering them: RP-1 forces the rating true and holds the limit where
 * it is, and the command REFUSES either argument rather than discarding it, so a
 * field here could only ever produce a refusal.</para>
 *
 * <para>Every field starts at what the complex already is, so the form opens
 * saying "no change" and an operator edits one axis rather than restating the
 * whole specification.</para>
 */
function ModifyForm({
  capacities,
  complex,
  funds,
  handle,
  lcId,
}: Readonly<{
  capacities: { [key: string]: number };
  complex: Rp1ComplexEntry;
  funds: number | null;
  handle: Parameters<typeof CommandButton>[0]["handle"];
  lcId: string;
}>) {
  const isHangar = complex.lcType === "Hangar";
  const name = complex.name ?? NULL_DISPLAY;
  const currentMass = magnitudeOf(complex.massMax);
  const massOrig = magnitudeOf(complex.massOrig);
  const currentWidth = magnitudeOf(complex.sizeMaxWidth) ?? 0;
  const currentHeight = magnitudeOf(complex.sizeMaxHeight) ?? 0;
  const currentDepth = magnitudeOf(complex.sizeMaxDepth) ?? 0;

  const [massMax, setMassMax] = useState(value("t", currentMass ?? 0));
  const [width, setWidth] = useState(value("m", currentWidth));
  const [height, setHeight] = useState(value("m", currentHeight));
  const [depth, setDepth] = useState(value("m", currentDepth));
  const [humanRated, setHumanRated] = useState(complex.humanRated === true);
  const [reassign, setReassign] = useState(false);

  const wantedMass = magnitudeOf(massMax) ?? 0;
  const nextSpec: LcSpec = {
    humanRated: isHangar || humanRated,
    isHangar,
    massMax: isHangar ? (currentMass ?? 0) : wantedMass,
    resources: new Map(Object.entries(capacities)),
    sizeMaxDepth: magnitudeOf(depth) ?? 0,
    sizeMaxHeight: magnitudeOf(height) ?? 0,
    sizeMaxWidth: magnitudeOf(width) ?? 0,
  };
  const current: LcCurrent = {
    humanRated: complex.humanRated === true,
    isHangar,
    launchPadCount: magnitudeOf(complex.launchPadCount) ?? 1,
    massMax: currentMass ?? 0,
    massOrig: massOrig ?? currentMass ?? 0,
    resources: new Map(Object.entries(capacities)),
    sizeMaxDepth: currentDepth,
    sizeMaxHeight: currentHeight,
    sizeMaxWidth: currentWidth,
  };

  const quote = quoteModifyComplex(nextSpec, current);
  const engineers = magnitudeOf(complex.engineers) ?? 0;
  const short = funds !== null && quote !== null && funds < quote.total;

  /*
   * RP-1's own envelope, and the reason `massOrig` is on the wire: a renovation
   * is refused outside max(3, floor(massOrig x 2)) and max(1, ceil(x 0.5)), in
   * these words. Refused here as well as there, because a press that could only
   * come back refused is a press worth darkening.
   */
  const ceiling =
    massOrig === null ? null : Math.max(3, Math.floor(massOrig * 2));
  const floor =
    massOrig === null ? null : Math.max(1, Math.ceil(massOrig * 0.5));
  const overCeiling = !isHangar && ceiling !== null && wantedMass > ceiling;
  const underFloor = !isHangar && floor !== null && wantedMass < floor;

  const sized = [
    nextSpec.sizeMaxWidth,
    nextSpec.sizeMaxHeight,
    nextSpec.sizeMaxDepth,
  ].every((axis) => axis > 0);
  const blocked =
    overCeiling || underFloor || !sized || (!isHangar && wantedMass <= 0);
  const confirm = `Confirm renovating ${name}, which takes its ${engineers} engineers off for the whole build`;

  return (
    <Disclosure
      ariaLabel={`Renovate ${name}`}
      asButton
      buttonSize="sm"
      chevron={false}
      label={(open: boolean) => (open ? "Hide renovation" : "Renovate")}
      panelHeight="auto"
      variant="inline"
    >
      <Stack gap="sm">
        {!isHangar && (
          <>
            <UnitInput
              label="Tonnage limit"
              onChange={setMassMax}
              unit="t"
              value={massMax}
            />
            {overCeiling && (
              <Text size="xs" tone="warn">
                Cannot upgrade tonnage above the limit of{" "}
                <Unit value={value("t", ceiling ?? 0)} />
              </Text>
            )}
            {underFloor && (
              <Text size="xs" tone="warn">
                Cannot downgrade tonnage below the limit of{" "}
                <Unit value={value("t", floor ?? 0)} />
              </Text>
            )}
          </>
        )}

        <UnitInput label="Width" onChange={setWidth} unit="m" value={width} />
        <UnitInput
          label="Height"
          onChange={setHeight}
          unit="m"
          value={height}
        />
        <UnitInput label="Length" onChange={setDepth} unit="m" value={depth} />

        {!isHangar && (
          <Switch
            checked={humanRated}
            label="Human-rated"
            onChange={setHumanRated}
          />
        )}

        {/* Said BEFORE the press. RP-1 takes the crew off first and tells you
            afterwards, in a dialog; the toggle is what makes its second sentence
            true. */}
        <Text size="xs" tone="muted">
          {engineers} engineers are unassigned for the whole renovation
        </Text>
        <Switch
          checked={reassign}
          label="Reassign them when it is done"
          onChange={setReassign}
        />

        {quote?.isDowngrade === true && (
          <Text size="xs" tone="warn">
            a reduction, and RP-1 charges half the difference for one: this is a
            bill, not a refund
          </Text>
        )}

        <Row as="div">
          <Text size="xs" tone={short ? "warn" : "muted"}>
            {quote === null ? (
              "no price: RP-1 has not said what this would cost"
            ) : (
              <>
                <Unit value={value("funds", quote.total)} decimals={0} />
                {short && " · more than the balance, so it builds slower"}
              </>
            )}
          </Text>
          <CommandButton
            args={renovationArgs({
              capacities,
              humanRated,
              isHangar,
              lcId,
              reassign,
              spec: nextSpec,
              wantedMass,
            })}
            aria-label={`Queue the renovation of ${name}`}
            commandLabel={`Queue the renovation of ${name}`}
            confirmAriaLabel={confirm}
            confirmLabel="Confirm"
            disabled={blocked}
            handle={handle}
            label="Renovate"
            size="sm"
          />
        </Row>
      </Stack>
    </Disclosure>
  );
}

/**
 * The command's arguments, with the two the hangar refuses OMITTED rather than
 * sent as the values it would have forced.
 */
function renovationArgs({
  capacities,
  humanRated,
  isHangar,
  lcId,
  reassign,
  spec,
  wantedMass,
}: Readonly<{
  capacities: { [key: string]: number };
  humanRated: boolean;
  isHangar: boolean;
  lcId: string;
  reassign: boolean;
  spec: LcSpec;
  wantedMass: number;
}>) {
  const size = {
    sizeMaxDepth: spec.sizeMaxDepth,
    sizeMaxHeight: spec.sizeMaxHeight,
    sizeMaxWidth: spec.sizeMaxWidth,
  };
  const shared = {
    assignEngineersOnComplete: reassign,
    lcId,
    resources: { ...capacities },
    size,
  };
  return isHangar ? shared : { ...shared, humanRated, massMax: wantedMass };
}
