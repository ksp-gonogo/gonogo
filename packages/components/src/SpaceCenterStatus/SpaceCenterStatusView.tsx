import {
  type CommandButtonHandle,
  EmptyState,
  Panel,
  Section,
  Tooltip,
  Unit,
  type UnitValue,
  useWidgetSegmentBound,
} from "@ksp-gonogo/ui-kit";
import { FacilityGridItem } from "./FacilityCell";
import { FACILITIES, type FacilityLevels } from "./facilities";
import {
  AbsenceLine,
  Body,
  FacilityGrid,
  FundsReadout,
  PadStatusLine,
} from "./styles";

export interface SpaceCenterStatusViewProps {
  w: number | undefined;
  h: number | undefined;
  careerFunds: number | null;
  heldFunds: boolean;
  fundsReading: UnitValue<"funds">;
  chargesFunds: boolean;
  padLine: string;
  facilities: FacilityLevels;
  upgradeBlocked: boolean;
  upgradeCmd: CommandButtonHandle;
}

export function SpaceCenterStatusView({
  w,
  h,
  careerFunds,
  heldFunds,
  fundsReading,
  chargesFunds,
  padLine,
  facilities,
  upgradeBlocked,
  upgradeCmd,
}: SpaceCenterStatusViewProps) {
  const cols = w ?? 6;
  const rows = h ?? 8;
  const showSubtitle = rows >= 4;
  // Two columns below width 6, where three would wrap facility names into ribbons.
  const compactGrid = cols < 6;
  // Below 9 columns the tier lists do not fit a cell; the descriptions stay in the hover tooltip.
  const tierSpecsFit = cols >= 9;
  // A producer emits tier text for every facility or for none, so the whole-grid silence is stated once.
  const anyTierText = FACILITIES.some(({ key }) => {
    const f = facilities[key];
    return !!f && (f.currentLevelText !== "" || f.nextLevelText !== "");
  });
  // A facility whose tiers did not arrive is not a facility at tier 0, so it gets no cell.
  const answeredFacilities = FACILITIES.filter(
    ({ key }) => facilities[key] !== undefined,
  );
  // Whether an Uplink has a section to put in the body, counting only those whose mod is running.
  const contributed = useWidgetSegmentBound("sections");

  return (
    <Panel
      panelTitle="SPACE CENTER"
      sections={
        <Section>
          <Body>
            {showSubtitle && (
              <PadStatusLine role="status" aria-live="polite">
                {padLine}
                {careerFunds !== null || heldFunds ? (
                  <Tooltip text="Available funds" focusable>
                    <FundsReadout>
                      · <Unit value={fundsReading} />
                    </FundsReadout>
                  </Tooltip>
                ) : null}
                {careerFunds === null &&
                  !heldFunds &&
                  /* The balance is required beside a spend control; sandbox charges nothing. */
                  chargesFunds && (
                    <Tooltip text="No funds balance has arrived" focusable>
                      <FundsReadout>· funds unknown</FundsReadout>
                    </Tooltip>
                  )}
              </PadStatusLine>
            )}
            {/* An Uplink that draws the tiers itself answers the absence; the pad line and funds stay either way. */}
            {answeredFacilities.length === 0 && !contributed && (
              <EmptyState>No facility tiers</EmptyState>
            )}
            {tierSpecsFit && answeredFacilities.length > 0 && !anyTierText && (
              /* Said once for the grid, and not at all when no facility answered. */
              <AbsenceLine>No tier detail</AbsenceLine>
            )}
            {answeredFacilities.length > 0 && (
              <FacilityGrid $compact={compactGrid}>
                {answeredFacilities.map(({ key, label }) => (
                  <FacilityGridItem
                    key={key}
                    facilityKey={key}
                    label={label}
                    f={facilities[key]}
                    tierSpecsFit={tierSpecsFit}
                    anyTierText={anyTierText}
                    careerFunds={careerFunds}
                    tiersHeldSince={facilities[key]?.heldSince ?? null}
                    upgradeBlocked={upgradeBlocked}
                    upgradeCmd={upgradeCmd}
                  />
                ))}
              </FacilityGrid>
            )}
          </Body>
        </Section>
      }
    />
  );
}
