import {
  Button,
  CheckIcon,
  ChevronUpIcon,
  type CommandButtonHandle,
} from "@ksp-gonogo/ui-kit";

export interface UpgradeButtonProps {
  upgradeCmd: CommandButtonHandle;
  facilityId: string;
  facilityLabel: string;
  titleOverride?: string;
}

/**
 * The facility cell's upgrade control. Its word collapses to an icon in a cell
 * about two grid columns wide.
 */
export function UpgradeButton({
  upgradeCmd,
  facilityId,
  facilityLabel,
  titleOverride,
}: UpgradeButtonProps) {
  return (
    <Button
      command={upgradeCmd.with(
        { facilityId },
        { label: `Upgrade ${facilityLabel}` },
      )}
      variant="ghost"
      confirmLabel="Confirm"
      icon={<ChevronUpIcon size={12} />}
      confirmIcon={<CheckIcon size={12} />}
      tip={titleOverride}
    >
      Upgrade
    </Button>
  );
}
