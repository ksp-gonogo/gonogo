import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  CommandButton,
  type CommandButtonHandle,
  speakQuantity,
} from "@ksp-gonogo/ui-kit";

/** Hire: a funds spend, arm-then-confirm via the shared {@link CommandButton}; the wrapper supplies an accessible name that says the cost. */
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
    <CommandButton
      handle={hireCmd}
      args={{ applicantName }}
      commandLabel={`Hire ${who}`}
      size="sm"
      label="Hire"
      confirmLabel="Confirm"
      pendingLabel="Hiring..."
      aria-label={`Hire ${who}${costText}`}
      confirmAriaLabel={`Confirm hire of ${who}${costText}`}
      pendingAriaLabel={`Hiring ${who}`}
    />
  );
}

/**
 * Fire: no cost, but the same two-step commit, since a fire is destructive
 * even though a re-hire restores the kerbal. Renders only on a row whose
 * standing `career.crew.fire` accepts.
 */
export function FireButton({
  kerbalName,
  fireCmd,
}: {
  kerbalName: string;
  fireCmd: CommandButtonHandle;
}) {
  const who = kerbalName || "crew member";
  return (
    <CommandButton
      handle={fireCmd}
      args={{ kerbalName }}
      commandLabel={`Fire ${who}`}
      size="sm"
      label="Fire"
      confirmLabel="Confirm"
      confirmTone="nogo"
      pendingLabel="Firing..."
      aria-label={`Fire ${who}`}
      confirmAriaLabel={`Confirm fire of ${who}`}
      pendingAriaLabel={`Firing ${who}`}
    />
  );
}
