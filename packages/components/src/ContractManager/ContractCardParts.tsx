import { formatCompactCurrency } from "@ksp-gonogo/core";
import {
  Badge,
  formatStreamStatus,
  severityFromStreamStatus,
} from "@ksp-gonogo/ui-kit";
import type { heldGrade } from "../shared/heldGrade";
import { type ContractEntry, formatDeadline } from "./contracts";
import {
  DEADLINE_STYLE,
  REWARD_LABEL_STYLE,
  REWARD_STYLE,
  REWARD_VALUE_STYLE,
  REWARDS_STYLE,
} from "./styles";

/** A card's title-row trailer: the deadline, and the held mark while the board is not current. */
export function ContractDeadline({
  deadlineUt,
  universalTime,
  boardHeld,
}: Readonly<{
  deadlineUt: number;
  universalTime: number;
  boardHeld: ReturnType<typeof heldGrade>;
}>) {
  return (
    <>
      <span style={DEADLINE_STYLE}>
        {formatDeadline(deadlineUt, universalTime)}
      </span>
      {boardHeld !== undefined && (
        /* On the card, in the operator's eyeline while they look at its Cancel. */
        <Badge
          severity={severityFromStreamStatus(boardHeld)}
          size="sm"
          title="Contract board is no longer current"
        >
          {formatStreamStatus(boardHeld)}
        </Badge>
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
