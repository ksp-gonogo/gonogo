import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Button,
  type CommandButtonHandle,
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
    <Button
      command={fireCmd.with({ kerbalName }, { label: `Fire ${who}` })}
      variant="ghost"
      size="sm"
      confirmLabel="Confirm"
      confirmTone="nogo"
      aria-label={`Fire ${who}`}
      confirmAriaLabel={`Confirm fire of ${who}`}
    >
      Fire
    </Button>
  );
}
