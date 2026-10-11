import { formatCompactCurrency } from "@ksp-gonogo/core";
import { HeldBadge } from "@ksp-gonogo/ui-kit";
import type { heldGrade } from "../shared/heldGrade";
import { type ContractEntry, formatDeadline } from "./contracts";
import {
  CANCEL_COST_STYLE,
  DEADLINE_STYLE,
  PENALTY_VALUE_STYLE,
  REWARD_LABEL_STYLE,
  REWARD_STYLE,
  REWARD_VALUE_STYLE,
  REWARDS_STYLE,
} from "./styles";

/** A card's title-row trailer: the deadline, and the held mark while the board is held. */
export function ContractDeadline({
  deadlineUt,
  universalTime,
  boardHeld,
}: Readonly<{
  deadlineUt: number;
  universalTime: number | undefined;
  boardHeld: ReturnType<typeof heldGrade>;
}>) {
  return (
    <>
      <span style={DEADLINE_STYLE}>
        {formatDeadline(deadlineUt, universalTime)}
      </span>
      {boardHeld !== undefined && (
        /* On the card, in the operator's eyeline while they look at its Cancel. */
        <HeldBadge grade={boardHeld} subject="Contract board" size="sm" />
      )}
    </>
  );
}

/** What completing the contract pays, one figure per currency it pays in. */
export function ContractRewards({
  contract: c,
}: Readonly<{ contract: ContractEntry }>) {
  return (
    <div style={REWARDS_STYLE}>
      {c.fundsCompletion > 0 && (
        <div style={REWARD_STYLE}>
          <span style={REWARD_LABEL_STYLE}>FUNDS</span>
          <span style={REWARD_VALUE_STYLE}>
            {formatCompactCurrency(c.fundsCompletion)}
          </span>
        </div>
      )}
      {c.scienceCompletion > 0 && (
        <div style={REWARD_STYLE}>
          <span style={REWARD_LABEL_STYLE}>SCI</span>
          <span style={REWARD_VALUE_STYLE}>
            {c.scienceCompletion.toFixed(1)}
          </span>
        </div>
      )}
      {c.repCompletion > 0 && (
        <div style={REWARD_STYLE}>
          <span style={REWARD_LABEL_STYLE}>REP</span>
          <span style={REWARD_VALUE_STYLE}>{c.repCompletion.toFixed(1)}</span>
        </div>
      )}
    </div>
  );
}

/**
 * What cancelling the contract takes, beside the control that does it. The
 * failure penalty is charged at the press, so a figure the wire did not carry
 * is left off rather than drawn as free.
 */
export function ContractCancelCost({
  contract: c,
}: Readonly<{ contract: ContractEntry }>) {
  const funds = c.fundsFailure !== null && c.fundsFailure > 0;
  const rep = c.repFailure !== null && c.repFailure > 0;
  if (!funds && !rep) return null;
  return (
    <div style={CANCEL_COST_STYLE}>
      <span style={REWARD_LABEL_STYLE}>CANCEL COSTS</span>
      {funds && c.fundsFailure !== null && (
        <span style={REWARD_STYLE}>
          <span style={REWARD_LABEL_STYLE}>FUNDS</span>
          <span style={PENALTY_VALUE_STYLE}>
            −{formatCompactCurrency(c.fundsFailure)}
          </span>
        </span>
      )}
      {rep && c.repFailure !== null && (
        <span style={REWARD_STYLE}>
          <span style={REWARD_LABEL_STYLE}>REP</span>
          <span style={PENALTY_VALUE_STYLE}>−{c.repFailure.toFixed(1)}</span>
        </span>
      )}
    </div>
  );
}
