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
  enabled,
  disabledReason,
  hireCmd,
}: {
  applicantName: string;
  hireCost: number | null;
  enabled: boolean;
  disabledReason?: string;
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
      disabled={!enabled}
      title={enabled ? undefined : disabledReason}
      aria-label={
        enabled
          ? `Hire ${who}${costText}`
          : `Hire ${who}${costText} (${disabledReason ?? "unavailable"})`
      }
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

/** Why Hire is refused, in the order an operator would fix it: space on the roster, a quoted price, then the funds. */
export function hireRefusal({
  rosterFull,
  hireCost,
  affordable,
}: {
  rosterFull: boolean;
  hireCost: number | null;
  affordable: boolean;
}): string | undefined {
  if (rosterFull) return "Roster full";
  if (hireCost === null) return "Hire price not quoted";
  if (!affordable) return "Insufficient funds";
  return undefined;
}
