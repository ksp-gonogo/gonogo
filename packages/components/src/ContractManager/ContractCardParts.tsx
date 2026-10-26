import { value } from "@ksp-gonogo/sitrep-sdk";
import { HeldFigure, heldWord, NULL_DISPLAY, Unit } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
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

/** The time left to accept an offered contract before it is withdrawn, against the confirmed view UT. */
function OfferExpiry({
  expireUt,
  universalTime,
}: Readonly<{ expireUt: number | null; universalTime: number | undefined }>) {
  if (expireUt === null || expireUt <= 0 || universalTime === undefined) {
    return NULL_DISPLAY;
  }
  const remaining = expireUt - universalTime;
  if (remaining <= 0) return "offer withdrawn";
  return (
    <>
      offer ends in <Unit value={value("s", Math.max(60, remaining))} />
    </>
  );
}

/** A card's title-row trailer: the deadline of an accepted contract or the expiry of an offer, carrying the held mark while the board is held. */
export function ContractDeadline({
  contract,
  offered,
  universalTime,
  boardHeld,
}: Readonly<{
  contract: ContractEntry;
  /** The contract is an offer: its trailer is the time left to accept it. */
  offered: boolean;
  universalTime: number | undefined;
  boardHeld: ReturnType<typeof heldGrade>;
}>) {
  const deadline = offered ? (
    <OfferExpiry expireUt={contract.expireUt} universalTime={universalTime} />
  ) : (
    formatDeadline(contract.deadlineUt, universalTime)
  );
  return (
    <span style={DEADLINE_STYLE}>
      {boardHeld === undefined ? (
        deadline
      ) : (
        /* On the card, in the operator's eyeline while they look at its Cancel. */
        <HeldFigure caption={heldWord(boardHeld)}>{deadline}</HeldFigure>
      )}
    </span>
  );
}

/** A figure the board draws, carrying the held mark while the board is held. */
function BoardFigure({
  held,
  children,
}: Readonly<{
  held: ReturnType<typeof heldGrade>;
  children: ReactNode;
}>) {
  return held === undefined ? (
    <>{children}</>
  ) : (
    <HeldFigure data-held="" caption={heldWord(held)}>
      {children}
    </HeldFigure>
  );
}

/** What completing the contract pays, one figure per currency it pays in. */
export function ContractRewards({
  contract: c,
  boardHeld,
}: Readonly<{
  contract: ContractEntry;
  boardHeld?: ReturnType<typeof heldGrade>;
}>) {
  return (
    <div style={REWARDS_STYLE}>
      {c.fundsCompletion !== 0 && (
        <div style={REWARD_STYLE}>
          <span style={REWARD_LABEL_STYLE}>FUNDS</span>
          <span style={REWARD_VALUE_STYLE}>
            {c.fundsCompletion === null ? (
              NULL_DISPLAY
            ) : (
              <BoardFigure held={boardHeld}>
                <Unit value={value("funds", c.fundsCompletion)} />
              </BoardFigure>
            )}
          </span>
        </div>
      )}
      {c.scienceCompletion !== 0 && (
        <div style={REWARD_STYLE}>
          <span style={REWARD_LABEL_STYLE}>SCI</span>
          <span style={REWARD_VALUE_STYLE}>
            {c.scienceCompletion === null ? (
              NULL_DISPLAY
            ) : (
              <BoardFigure held={boardHeld}>
                <Unit value={value("science", c.scienceCompletion)} />
              </BoardFigure>
            )}
          </span>
        </div>
      )}
      {c.repCompletion !== 0 && (
        <div style={REWARD_STYLE}>
          <span style={REWARD_LABEL_STYLE}>REP</span>
          <span style={REWARD_VALUE_STYLE}>
            {c.repCompletion === null ? (
              NULL_DISPLAY
            ) : (
              <BoardFigure held={boardHeld}>
                <Unit value={value("rep", c.repCompletion)} />
              </BoardFigure>
            )}
          </span>
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
  boardHeld,
}: Readonly<{
  contract: ContractEntry;
  boardHeld?: ReturnType<typeof heldGrade>;
}>) {
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
            −
            <BoardFigure held={boardHeld}>
              <Unit value={value("funds", c.fundsFailure)} />
            </BoardFigure>
          </span>
        </span>
      )}
      {rep && c.repFailure !== null && (
        <span style={REWARD_STYLE}>
          <span style={REWARD_LABEL_STYLE}>REP</span>
          <span style={PENALTY_VALUE_STYLE}>
            −
            <BoardFigure held={boardHeld}>
              <Unit value={value("rep", c.repFailure)} />
            </BoardFigure>
          </span>
        </span>
      )}
    </div>
  );
}

/** What a failed contract cost the career, as the funds and reputation it took; a figure the wire did not carry is left off. */
export function ContractFailureCost({
  contract: c,
}: Readonly<{ contract: ContractEntry }>) {
  const funds = c.fundsFailure !== null && c.fundsFailure > 0;
  const rep = c.repFailure !== null && c.repFailure > 0;
  if (!funds && !rep) return null;
  return (
    <div style={REWARDS_STYLE}>
      {funds && c.fundsFailure !== null && (
        <div style={REWARD_STYLE}>
          <span style={REWARD_LABEL_STYLE}>FUNDS</span>
          <span style={PENALTY_VALUE_STYLE}>
            −<Unit value={value("funds", c.fundsFailure)} />
          </span>
        </div>
      )}
      {rep && c.repFailure !== null && (
        <div style={REWARD_STYLE}>
          <span style={REWARD_LABEL_STYLE}>REP</span>
          <span style={PENALTY_VALUE_STYLE}>
            −<Unit value={value("rep", c.repFailure)} />
          </span>
        </div>
      )}
    </div>
  );
}
