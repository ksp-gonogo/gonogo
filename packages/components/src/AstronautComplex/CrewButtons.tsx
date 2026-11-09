import { canBeSacked, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Button,
  type CommandButtonHandle,
  type CommandControlState,
  speakQuantity,
} from "@ksp-gonogo/ui-kit";

/** Hire: a funds spend, arm-then-confirm via the shared {@link Button}; the wrapper supplies an accessible name that says the cost. */
export function HireButton({
  applicantName,
  hireCost,
  hireCmd,
}: {
  applicantName: string;
  hireCost: number | null;
  hireCmd: CommandButtonHandle;
}) {
  // The cost lives in the header, so the accessible name still has to say it; words, since it never renders on screen.
  const costText =
    hireCost === null
      ? ""
      : ` for ${speakQuantity(value("funds", hireCost), { decimals: 0 })}`;
  const who = applicantName || "applicant";

  return (
    <Button
      command={hireCmd.with({ applicantName }, { label: `Hire ${who}` })}
      variant="ghost"
      size="sm"
      confirmLabel="Confirm"
      aria-label={`Hire ${who}${costText}`}
      confirmAriaLabel={`Confirm hire of ${who}${costText}`}
    >
      Hire
    </Button>
  );
}

/** Why the game is likely to refuse a fire for a kerbal in this standing, or `undefined` when the roster accepts it. A resting kerbal can be fired though not flown. */
export function fireAdvice(
  standing: Parameters<typeof canBeSacked>[0],
  label: string,
): string | undefined {
  if (canBeSacked(standing)) return undefined;
  return `the game does not allow this kerbal to be fired ${
    label === "" ? "in their current state" : `while ${label.toLowerCase()}`
  }`;
}

/**
 * Fire: no cost, but the same two-step commit, since a fire is destructive
 * even though a re-hire restores the kerbal. A row whose standing
 * `career.crew.fire` is likely to refuse still draws it, advised.
 */
export function FireButton({
  kerbalName,
  fireCmd,
  control,
  advise,
}: {
  kerbalName: string;
  fireCmd: CommandButtonHandle;
  /** A control already running for this kerbal's fire, which a bound key presses as well; absent, the button runs its own. */
  control?: CommandControlState;
  /** Why the game is likely to refuse this fire; the button stays and the press is sent. Used when the button runs its own control. */
  advise?: string;
}) {
  const who = kerbalName || "crew member";
  return (
    <Button
      command={
        control ?? fireCmd.with({ kerbalName }, { label: `Fire ${who}` })
      }
      variant="ghost"
      size="sm"
      confirmLabel="Confirm"
      confirmTone="nogo"
      advise={advise}
      aria-label={`Fire ${who}`}
      confirmAriaLabel={`Confirm fire of ${who}`}
    >
      Fire
    </Button>
  );
}
