import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  type CommandButtonHandle,
  NULL_DISPLAY,
  resolveCurrency,
  sayHeld,
  Tooltip,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { type HeldSince, heldFigure } from "../shared/heldFigure";
import {
  type FacilityKey,
  type FacilityLevel,
  KEY_TO_ENUM_FACILITY,
} from "./facilities";
import {
  FacilityCell,
  FacilityLabel,
  FacilityValue,
  MaxBadge,
  Muted,
  Slash,
  Tier,
  TierMax,
  TierSpecs,
  UpgradeCost,
  UpgradeRow,
} from "./styles";
import { buildFacilityTooltip, plainTierSpecs, TierBlock } from "./TierBlock";
import { UpgradeButton } from "./UpgradeButton";

function affordVerdict(
  moneyDecides: boolean,
  canAfford: boolean,
): "yes" | "no" | undefined {
  if (!moneyDecides) return undefined;
  return canAfford ? "yes" : "no";
}

export interface FacilityGridItemProps {
  facilityKey: FacilityKey;
  label: string;
  f: FacilityLevel | undefined;
  tierSpecsFit: boolean;
  anyTierText: boolean;
  careerFunds: number | null;
  tiersHeldSince: HeldSince;
  upgradeBlocked: boolean;
  upgradeCmd: CommandButtonHandle;
}

export function FacilityGridItem({
  facilityKey,
  label,
  f,
  tierSpecsFit,
  anyTierText,
  careerFunds,
  tiersHeldSince,
  upgradeBlocked,
  upgradeCmd,
}: FacilityGridItemProps) {
  // `max` is the top tier's zero-based index, so the display reads `{level+1}/{max+1}`.
  const atMax = !!f && f.max > 0 && f.level >= f.max;
  const displayLevel = f ? f.level + 1 : 0;
  const displayMax = f && f.max > 0 ? f.max + 1 : 0;
  // An absent balance must NOT satisfy this check: not knowing the balance is not knowing it is affordable.
  const canAfford =
    !!f &&
    f.upgradeFunds > 0 &&
    careerFunds !== null &&
    careerFunds >= f.upgradeFunds;
  // A blocked command is refused for a reason the balance has no part in, and a balance that is held answers nothing, so either way the price is a plain figure.
  const moneyDecides = !upgradeBlocked && careerFunds !== null;
  const verdict = affordVerdict(moneyDecides, canAfford);
  const tooltip = buildFacilityTooltip(label, f);
  // Gated on the whole grid: a cell whose own description is empty still has to say so.
  const showTierSpecs = tierSpecsFit && anyTierText && !!f;
  // Only a facility with somewhere left to go owes a NEXT block; `max === 0` is an unknown ceiling.
  const hasNextTier = !!f && f.max > 0 && !atMax;
  const tier = heldFigure(value("count", displayLevel), tiersHeldSince);
  const { caption: heldCaption } = resolveCurrency(tier);

  return (
    <Tooltip text={tooltip || undefined} focusable>
      <FacilityCell>
        <FacilityLabel>{label}</FacilityLabel>
        <FacilityValue
          // So AT announces "Launch Pad tier 2 of 3" rather than the "2 / 3" spans as fragments.
          role="img"
          aria-label={
            f && f.max > 0
              ? sayHeld(
                  `${label} tier ${displayLevel} of ${displayMax}`,
                  heldCaption,
                )
              : `${label} tier unknown`
          }
        >
          {f && f.max > 0 ? (
            <>
              <Tier>
                {tiersHeldSince === null ? displayLevel : <Unit value={tier} />}
              </Tier>
              <Slash>/</Slash>
              <TierMax>{displayMax}</TierMax>
            </>
          ) : (
            <Muted>{NULL_DISPLAY}</Muted>
          )}
        </FacilityValue>
        {f && f.upgradeFunds > 0 && !atMax && (
          <UpgradeRow>
            <UpgradeCost
              $verdict={verdict}
              /* The verdict, observable from outside; absent when money decides nothing. */
              data-afford={verdict}
            >
              {/* The price comes off the same entry as the tiers, so it is held whenever they are. */}
              <Unit
                value={heldFigure(
                  value("funds", f.upgradeFunds),
                  tiersHeldSince,
                )}
                scale="compact"
              />
            </UpgradeCost>
            <UpgradeButton
              upgradeCmd={upgradeCmd}
              facilityId={KEY_TO_ENUM_FACILITY[facilityKey]}
              facilityLabel={label}
              titleOverride={
                f.nextLevelText
                  ? `Upgrade to tier ${displayLevel + 1}:\n${plainTierSpecs(f.nextLevelText)}`
                  : undefined
              }
            />
          </UpgradeRow>
        )}
        {atMax && <MaxBadge>MAX</MaxBadge>}
        {showTierSpecs && f && (
          <TierSpecs>
            <TierBlock heading="Now" text={f.currentLevelText} />
            {hasNextTier && <TierBlock heading="Next" text={f.nextLevelText} />}
          </TierSpecs>
        )}
      </FacilityCell>
    </Tooltip>
  );
}
