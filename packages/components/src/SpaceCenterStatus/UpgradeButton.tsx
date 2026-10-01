import {
  CheckIcon,
  ChevronUpIcon,
  CommandButton,
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
    <CommandButton
      handle={upgradeCmd}
      args={{ facilityId }}
      commandLabel={`Upgrade ${facilityLabel}`}
      label="Upgrade"
      confirmLabel="Confirm"
      pendingLabel="Upgrading"
      icon={<ChevronUpIcon size={12} />}
      confirmIcon={<CheckIcon size={12} />}
      title={titleOverride}
    />
  );
}
