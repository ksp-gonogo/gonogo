import {
  AutoEmptyState,
  type CommandButtonHandle,
  EmptyState,
  Panel,
  Section,
  Tooltip,
  Unit,
  type UnitValue,
  WidgetSections,
} from "@ksp-gonogo/ui-kit";
import { FacilityGridItem, type HeldSince } from "./FacilityCell";
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
  tiersHeldSince: HeldSince;
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
  tiersHeldSince,
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

  return (
    <Panel
      panelTitle="SPACE CENTER"
      panelSections={false}
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
            {tierSpecsFit && answeredFacilities.length > 0 && !anyTierText && (
              /* Said once for the grid, and not at all when no facility answered. */
              <AbsenceLine>No tier detail</AbsenceLine>
            )}
            {/* ONE absence marker for the grid plus whatever an Uplink appends, so a section that answered takes it off screen. */}
            <AutoEmptyState
              gap="related-comfortable"
              fallback={<EmptyState>No facility tiers</EmptyState>}
            >
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
                      tiersHeldSince={tiersHeldSince}
                      upgradeBlocked={upgradeBlocked}
                      upgradeCmd={upgradeCmd}
                    />
                  ))}
                </FacilityGrid>
              )}

              {/* Inside the marker's content area, so a section that draws tiers answers the absence. */}
              <WidgetSections />
            </AutoEmptyState>
          </Body>
        </Section>
      }
    />
  );
}
