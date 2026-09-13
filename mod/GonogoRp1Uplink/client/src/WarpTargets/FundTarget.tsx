import { useAlarmRequest, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import {
  ActionButton,
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
import { RP1 } from "../uplink";

/** Withdraw a target RP-1's own screen stood up. Must match `Rp1TargetCommands.CancelFundCommand`. */
export const RP1_FUND_TARGET_CANCEL_COMMAND = "rp1.fundTarget.cancel";

/**
 * The Topic carrying the career balance, and the path to it. `career.status` is
 * one of the Topics a SCET threshold may be armed against, and the balance is a
 * plain number on it, so the alarm below is a condition the simulation can read
 * for itself rather than one the ground has to poll.
 */
const CAREER_TOPIC = "career.status";
const FUNDS_PATH = "economy.funds";

/**
 * One alarm per career, matching RP-1's own one-target-per-career model. Asking
 * again under this key retargets the alarm rather than adding a second, so an
 * operator who revises a figure ends up with one row.
 */
const ALARM_KEY = "fund-target";

/**
 * The balance a warp should stop at, asked for as an ALARM rather than driven as
 * a warp.
 *
 * <para><b>RP-1 does not control warp from here any more.</b> It used to:
 * <c>rp1.fundTarget.set</c> wrote a stop-condition into RP-1's career and
 * <c>rp1.warp.toFundTarget</c> handed that condition to RP-1's own warp
 * controller. Both are gone. The two were one controller wearing two names, and
 * the thing they achieved is a thing the app already owns: a SCET threshold is
 * evaluated inside the simulation and sets <c>StopWarp</c> on the tick the
 * condition matches, which is the same halt on the same frame, in the operator's
 * own alarm list where it can be renamed, retargeted or deleted.</para>
 *
 * <para><b>The figure is the operator's, typed here.</b> It is not taken from
 * RP-1's standing target alone, because with the set command gone one only
 * exists after a trip through RP-1's in-game Maintenance screen, and a control
 * that is dark until you have done the thing in-game is no control. When a
 * target DOES stand, the input seeds from it: that figure is literally the
 * threshold RP-1 is working toward, and arming on it is a press rather than a
 * retype.</para>
 *
 * <para><b>It spends nothing, and no affordability line belongs here.</b> The
 * figure beside the control is the balance the alarm is MEASURED against, not a
 * price. RP-1's <c>FundTargetProject</c> returns project type <c>None</c>, its
 * <c>IncrementProgress</c> returns zero and its <c>Clear()</c> is a pure field
 * reset, so nothing on this control has ever touched a currency. Read on the
 * shipped RP-1 v4.6.0.0 RP0.dll.</para>
 *
 * <para><b>The balance row is ABSENT on a save with no funding</b> rather than
 * drawn as a zero. A sandbox career has no funds at all, and a "balance now" of
 * nothing is a figure the save does not have.</para>
 */
export function FundTargetControl({
  cancel,
  funds,
  target,
}: Readonly<{
  cancel: Parameters<typeof CommandButton>[0]["handle"];
  /** The career balance. Absent means say nothing, which is the sandbox case. */
  funds: number | null;
  target: Rp1FundTarget | undefined;
}>) {
  const requestAlarm = useAlarmRequest(RP1);
  const [typed, setTyped] = useState<Value<"funds"> | null>(null);

  const standing = target?.active === true;
  const wanted =
    typed ??
    value("funds", (standing && magnitudeOf(target?.targetFunds)) || 0);
  const wantedFunds = magnitudeOf(wanted) ?? 0;
  const spoken = wantedFunds.toLocaleString("en-GB");

  return (
    <Stack gap="xs">
      {standing && target !== undefined && (
        <StandingTarget handle={cancel} target={target} />
      )}

      <Disclosure
        ariaLabel="Set an alarm on the career balance"
        asButton
        buttonSize="sm"
        chevron={false}
        label={(open: boolean) =>
          open ? "Hide balance alarm" : "Balance alarm"
        }
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
            onChange={setTyped}
            unit="funds"
            value={wanted}
          />

          <Row as="div">
            <ActionButton
              aria-label={`Stop the warp when the balance reaches ${spoken} funds`}
              disabled={wantedFunds <= 0}
              onClick={() =>
                requestAlarm({
                  key: ALARM_KEY,
                  name: `Balance reaches ${spoken} funds`,
                  trigger: {
                    kind: "threshold",
                    topic: CAREER_TOPIC,
                    fieldPath: FUNDS_PATH,
                    op: ">=",
                    value: wantedFunds,
                    /*
                     * The craft's own clock rather than the operator's, which is
                     * the whole point: the simulation stops the warp on the tick
                     * the balance is reached, where a ground-side watch would
                     * read the number a light-time late and a poll later still.
                     *
                     * Unconditional on purpose, and it looks like it should not
                     * be: the app's own alarm builder hides its "Fires on" radio
                     * and pins the vantage to "command" whenever
                     * `useTimeContexts` reports no `scet` qualifier, which is any
                     * screen under a second of light time. That condition is
                     * about a LABEL, not a capability. The two clocks print the
                     * same string there, so a radio whose options read alike
                     * teaches the operator the distinction is decorative;
                     * nothing on the arming path consults it. The request is
                     * carried through untouched, armed on the mod, and fired off
                     * the simulation's own reading, at every delay including
                     * none. Pinned by "arms and fires an Uplink's SCET threshold
                     * on a screen with no SCET clock" in
                     * `packages/app/src/alarms/scet-alarm.integration.test.ts`,
                     * so nobody has to derive it again from the asymmetry.
                     */
                    vantage: "scet",
                  },
                })
              }
              type="button"
            >
              Set
            </ActionButton>
          </Row>
        </Stack>
      </Disclosure>
    </Stack>
  );
}

/**
 * A target RP-1 is holding: what it is, how long RP-1 thinks it will take, and
 * the one press that withdraws it.
 *
 * <para>Only RP-1's own Maintenance screen stands one of these up now, and this
 * is still worth drawing: an operator who set a target in-game can see it here
 * beside the alarm, and withdraw it without going back for the screen that set
 * it.</para>
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
