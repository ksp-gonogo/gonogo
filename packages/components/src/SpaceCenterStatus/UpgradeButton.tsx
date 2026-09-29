import type { CommandButtonHandle } from "@ksp-gonogo/ui-kit";
import {
  CheckIcon,
  ChevronUpIcon,
  commandLossSentence,
  Spinner,
  useCommandButton,
} from "@ksp-gonogo/ui-kit";
import { ConfirmUpgradeButton, UpgradeButtonStyled } from "./styles";

export interface UpgradeButtonProps {
  enabled: boolean;
  upgradeCmd: CommandButtonHandle;
  facilityId: string;
  facilityLabel: string;
  titleOverride?: string;
}

/**
 * The facility cell's upgrade control. Behaviour is the shared
 * `useCommandButton`; the chrome is local because the label has to collapse
 * to an icon in a cell about two grid columns wide.
 */
export function UpgradeButton({
  enabled,
  upgradeCmd,
  facilityId,
  facilityLabel,
  titleOverride,
}: UpgradeButtonProps) {
  const commandLabel = `Upgrade ${facilityLabel}`;
  const {
    isArmed,
    isBlocked,
    isPending,
    isRefused,
    isLost,
    refusalText,
    hasUnconfirmed,
    hasFailure,
    press,
  } = useCommandButton({
    handle: upgradeCmd,
    args: { facilityId },
    commandLabel,
  });

  if (isPending) {
    return (
      <UpgradeButtonStyled
        disabled
        aria-busy="true"
        title={titleOverride}
        label="Upgrading"
        icon={<Spinner size={12} />}
      />
    );
  }
  if (isRefused) {
    return (
      <ConfirmUpgradeButton
        onClick={() => press(true)}
        title={refusalText ?? titleOverride}
        aria-label={refusalText ?? undefined}
        label="Refused"
        icon={<ChevronUpIcon size={12} />}
      />
    );
  }
  if (isLost) {
    // Not the resting render: an upgrade nobody answered may or may not be building.
    const sentence = commandLossSentence({ label: commandLabel });
    return (
      <ConfirmUpgradeButton
        onClick={() => press(true)}
        title={sentence}
        aria-label={sentence}
        label="No reply"
        icon={<ChevronUpIcon size={12} />}
      />
    );
  }
  if (isBlocked) {
    /* A dark button with nothing on it reads like a maxed facility or a short
       balance, so the control says why. `aria-disabled`, not `disabled`, so it
       stays in the screen-reader walk; a gate verdict is advice, and the
       dispatch re-evaluates anyway. */
    return (
      <UpgradeButtonStyled
        aria-disabled="true"
        aria-label={refusalText ?? undefined}
        data-gate="blocked"
        onClick={() => press(true)}
        title={refusalText ?? titleOverride}
        label="Blocked"
        icon={<ChevronUpIcon size={12} />}
      />
    );
  }
  if (isArmed) {
    return (
      <ConfirmUpgradeButton
        onClick={() => press(true)}
        title={titleOverride}
        label="Confirm"
        icon={<CheckIcon size={12} />}
      />
    );
  }
  return (
    <UpgradeButtonStyled
      disabled={!enabled}
      data-unconfirmed={hasUnconfirmed ? "true" : undefined}
      data-failed={hasFailure ? "true" : undefined}
      onClick={() => press(true)}
      title={titleOverride}
      label="Upgrade"
      icon={<ChevronUpIcon size={12} />}
    />
  );
}
