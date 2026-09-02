import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  CommandButton,
  Disclosure,
  magnitudeOf,
  NULL_DISPLAY,
  Row,
  RowName,
  Stack,
  Text,
  Unit,
  UnitInput,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import type { Rp1FundTarget } from "../__generated__/contract";

/** Stand up a fund stop-condition. Must match `Rp1TargetCommands.SetFundCommand`. */
export const RP1_FUND_TARGET_SET_COMMAND = "rp1.fundTarget.set";

/** Withdraw it. Must match `Rp1TargetCommands.CancelFundCommand`. */
export const RP1_FUND_TARGET_CANCEL_COMMAND = "rp1.fundTarget.cancel";

/**
 * The balance a warp runs toward, and the two acts that decide it.
 *
 * <para><b>It spends nothing, and no affordability line belongs here.</b> A fund
 * target is a stop condition: RP-1's <c>FundTargetProject</c> ends a warp and
 * touches no currency, and its <c>Clear()</c> is a pure field reset. So the
 * figure beside the control is the balance the target is MEASURED against, not a
 * price. Read on the shipped RP-1 v4.6.0.0 RP0.dll.</para>
 *
 * <para><b>Set and cancel are one control because they are one piece of
 * state.</b> RP-1 holds a single <c>fundTarget</c> per career, so the two are
 * transitions of it rather than two features: exactly one of them is legal at
 * any moment, and the control offers whichever that is. A cancel drawn while
 * nothing stands could only ever report RP-1's own refusal, which asks
 * <c>IsValid</c> before it clears.</para>
 *
 * <para><b>The balance row is ABSENT on a save with no funding</b> rather than
 * drawn as a zero. A sandbox career has no funds at all, and a "balance now" of
 * nothing is a figure the save does not have.</para>
 *
 * <para>Both refusals RP-1 can give are worth knowing and neither is checked
 * here: a target equal to the balance is "already at this funding", and one the
 * career's income cannot reach inside RP-1's own two-year search is refused as
 * unreachable. Both are real statements about the save, so they come back from
 * the command in RP-1's words rather than being guessed at from a balance.</para>
 */
export function FundTargetControl({
  cancel,
  funds,
  set,
  target,
}: Readonly<{
  cancel: Parameters<typeof CommandButton>[0]["handle"];
  /** The career balance. Absent means say nothing, which is the sandbox case. */
  funds: number | null;
  set: Parameters<typeof CommandButton>[0]["handle"];
  target: Rp1FundTarget | undefined;
}>) {
  const [wanted, setWanted] = useState(value("funds", 0));

  if (target?.active === true) {
    return <StandingTarget handle={cancel} target={target} />;
  }

  const wantedFunds = magnitudeOf(wanted) ?? 0;

  return (
    <Disclosure
      ariaLabel="Set a fund target"
      asButton
      buttonSize="sm"
      chevron={false}
      label={(open: boolean) => (open ? "Hide fund target" : "Set fund target")}
      panelHeight="auto"
      variant="inline"
    >
      <Stack gap="xs">
        {funds !== null && (
          <Row as="div">
            <RowName>Balance now</RowName>
            <Unit value={value("funds", funds)} decimals={0} />
          </Row>
        )}

        <UnitInput
          label="Target balance"
          onChange={setWanted}
          unit="funds"
          value={wanted}
        />

        <Row as="div">
          <CommandButton
            args={{ targetFunds: wantedFunds }}
            aria-label={`Warp toward a balance of ${wantedFunds.toLocaleString("en-GB")} funds`}
            commandLabel={`Warp toward a balance of ${wantedFunds.toLocaleString("en-GB")} funds`}
            disabled={wantedFunds <= 0}
            handle={set}
            label="Set"
            size="sm"
          />
        </Row>
      </Stack>
    </Disclosure>
  );
}

/**
 * A target that stands: what it is, how long RP-1 thinks it will take, and the
 * one press that withdraws it.
 *
 * <para>No arm-then-confirm on the cancel. It spends nothing, and it is undone by
 * setting the target again, so an armed press would train an operator to
 * double-tap a reversible act.</para>
 */
function StandingTarget({
  handle,
  target,
}: Readonly<{
  handle: Parameters<typeof CommandButton>[0]["handle"];
  target: Rp1FundTarget;
}>) {
  return (
    <Row as="div">
      <Text size="xs" tone="muted">
        {target.targetFunds == null ? (
          NULL_DISPLAY
        ) : (
          <Unit value={target.targetFunds} decimals={0} />
        )}
        {target.timeLeft != null && (
          <>
            {" · "}
            <Unit value={target.timeLeft} /> away
          </>
        )}
      </Text>
      <CommandButton
        args={{}}
        aria-label="Cancel the fund target"
        commandLabel="Cancel the fund target"
        handle={handle}
        label="Cancel"
        size="sm"
      />
    </Row>
  );
}
