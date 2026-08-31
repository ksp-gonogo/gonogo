import {
  registerAugment,
  useCommand,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  CommandButton,
  Inline,
  magnitudeOf,
  Stack,
  Text,
  Unit,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import { current } from "../shared/current";
import { RP1 } from "../uplink";
// Side-effect import: hydrates these Topics' units at decode time. Here rather
// than left to the entry point's import order, because this file is the
// consumer that would silently receive bare numbers without it.
import "../topics";

/** Warp until the career's next project finishes. Must match `Rp1WarpCommands.ToCompleteCommand`. */
export const RP1_WARP_TO_COMPLETE_COMMAND = "rp1.warp.toComplete";

/** Warp until the balance reaches the fund target. Must match `Rp1WarpCommands.ToFundTargetCommand`. */
export const RP1_WARP_TO_FUND_TARGET_COMMAND = "rp1.warp.toFundTarget";

/**
 * RP-1's warp targets, beside the warp ladder that already exists.
 *
 * <para><b>Why this is an augment rather than a widget.</b> Warping is one act
 * with one piece of state, and the dashboard already has a control for it. RP-1
 * does not add a second kind of warp; it adds two things worth warping TO, which
 * is a stop condition rather than a new concept. So this binds
 * <c>warp-control.stepper</c>, the slot that exists for exactly this, and an
 * operator reads one warp control rather than hunting for whichever panel owns
 * the mod's version.</para>
 *
 * <para><b>Nothing here stops warp.</b> RP-1's own controller destroys itself the
 * moment it sees a warp rate of zero, so the host widget's existing "1x" button
 * already ends an RP-1 warp and a second control would be two buttons doing one
 * thing. That is a decision recorded in <c>Rp1WarpCommands</c> with the IL that
 * settles it, not an omission.</para>
 *
 * <para>Both presses are single, not armed: warping is reversible by the button
 * next door, and an arm-then-confirm on a reversible act trains an operator to
 * double-press everything.</para>
 */
export function WarpTargets() {
  const available = current(useTelemetry("rp1.available"));
  const fundTarget = current(useTelemetry("rp1.fundTarget"));

  // Unconditional and above the early return on purpose: a hook after it would
  // change count on the first frame RP-1 answers.
  const toComplete = useCommand(RP1_WARP_TO_COMPLETE_COMMAND);
  const toFundTarget = useCommand(RP1_WARP_TO_FUND_TARGET_COMMAND);
  usePanelDelay(toComplete);
  usePanelDelay(toFundTarget);

  // Invisible on every install without RP-1, which is most of them. An augment
  // that renders an empty row on a stock game is clutter that says nothing.
  if (available !== true) {
    return null;
  }

  /*
   * RP-1's own validity rule, which is not merely "a number": a target equal to
   * the balance it was set at is no instruction, and the wire carries the answer
   * rather than leaving this to re-derive it.
   */
  const targetStanding = fundTarget?.active === true;
  const remaining = magnitudeOf(fundTarget?.timeLeft);

  return (
    <Stack gap="xs">
      <Inline gap="xs">
        <CommandButton
          args={{}}
          aria-label="Warp until RP-1's next project finishes"
          commandLabel="Warp to next completion"
          handle={toComplete}
          label="Warp to next"
          size="sm"
        />
        <CommandButton
          args={{}}
          aria-label={
            targetStanding
              ? "Warp until the balance reaches the fund target"
              : "No fund target is standing, so there is no balance to warp toward"
          }
          commandLabel="Warp to fund target"
          disabled={!targetStanding}
          handle={toFundTarget}
          label="Warp to funds"
          size="sm"
        />
      </Inline>

      {/* Said rather than left blank: a dark button with no explanation reads as
          broken, and setting a target is an act the operator can take. */}
      {targetStanding ? (
        remaining === null ? null : (
          <Text size="xs" tone="muted">
            fund target in <Unit value={fundTarget?.timeLeft} /> at the current
            rate
          </Text>
        )
      ) : (
        <Text size="xs" tone="muted">
          no fund target set
        </Text>
      )}
    </Stack>
  );
}

registerAugment({
  id: "rp1-warp-targets",
  augments: "warp-control.stepper",
  component: WarpTargets,
  priority: 0,
  owner: RP1,
});
