import { getSizeBucket } from "@ksp-gonogo/core";
import {
  AutoEmptyState,
  type CommandButtonHandle,
  EmptyState,
  Panel,
  Section,
  Unit,
  type UnitValue,
  WidgetSections,
} from "@ksp-gonogo/ui-kit";
import { FundsDrain, reportsFundsDrain } from "../shared/FundsDrain";
import { FacilityGridItem, type HeldSince } from "./FacilityCell";
import { FACILITIES, type FacilityLevels } from "./facilities";
import { SpaceCenterStatusTiny } from "./SpaceCenterStatusTiny";
import {
  AbsenceLine,
  Body,
  DrainReadout,
  FacilityGrid,
  FundsReadout,
  PadStatusLine,
} from "./styles";

export interface SpaceCenterStatusViewProps {
  w: number | undefined;
  h: number | undefined;
  careerFunds: number | null;
  netFunds: number | null;
  heldFunds: boolean;
  fundsReading: UnitValue<"funds">;
  chargesFunds: boolean;
  padOccupied: boolean | null | undefined;
  padLine: string;
  tiersHeldSince: HeldSince;
  facilities: FacilityLevels;
  upgradesEnabled: boolean;
  upgradeBlocked: boolean;
  upgradeCmd: CommandButtonHandle;
}

export function SpaceCenterStatusView({
  w,
  h,
  careerFunds,
  netFunds,
  heldFunds,
  fundsReading,
  chargesFunds,
  padOccupied,
  padLine,
  tiersHeldSince,
  facilities,
  upgradesEnabled,
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
  const sizeBucket = getSizeBucket(w, h);
  // A producer emits tier text for every facility or for none, so the whole-grid silence is stated once.
  const anyTierText = FACILITIES.some(({ key }) => {
    const f = facilities[key];
    return !!f && (f.currentLevelText !== "" || f.nextLevelText !== "");
  });
  // A facility whose tiers did not arrive is not a facility at tier 0, so it gets no cell.
  const answeredFacilities = FACILITIES.filter(
    ({ key }) => facilities[key] !== undefined,
  );

  if (sizeBucket === "tiny") {
    return (
      <SpaceCenterStatusTiny
        careerFunds={careerFunds}
        netFunds={netFunds}
        heldFunds={heldFunds}
        fundsReading={fundsReading}
        padOccupied={padOccupied}
        padLine={padLine}
      />
    );
  }

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
                  <FundsReadout title="Available funds">
                    · <Unit value={fundsReading} />
                  </FundsReadout>
                ) : null}
                {reportsFundsDrain(netFunds) && (
                  <DrainReadout>
                    <FundsDrain
                      funds={careerFunds}
                      netPerDay={netFunds}
                      separator
                    />
                  </DrainReadout>
                )}
                {careerFunds === null &&
                  !heldFunds &&
                  /* The balance is required beside a spend control; sandbox charges nothing. */
                  chargesFunds && (
                    <FundsReadout title="No funds balance has arrived">
                      · funds unknown
                    </FundsReadout>
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
                      upgradesEnabled={upgradesEnabled}
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
