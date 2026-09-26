import { getSizeBucket } from "@ksp-gonogo/core";
import type { Value } from "@ksp-gonogo/sitrep-sdk";
import {
  AutoEmptyState,
  type CommandButtonHandle,
  EmptyState,
  Panel,
  ReadoutCaption,
  Section,
  Unit,
  type UnitValue,
  WidgetSections,
} from "@ksp-gonogo/ui-kit";
import { FundsDrain, reportsFundsDrain } from "../shared/FundsDrain";
import { FacilityGridItem } from "./FacilityCell";
import { FACILITIES, type FacilityLevels } from "./facilities";
import { SpaceCenterStatusTiny } from "./SpaceCenterStatusTiny";
import {
  AbsenceLine,
  Body,
  DrainReadout,
  FacilityGrid,
  FundsReadout,
  PadStatusLine,
  UpgradesHeld,
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
  heldUpgradeInputs: readonly string[];
  tiersHeldFor: Value<"s"> | undefined;
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
  heldUpgradeInputs,
  tiersHeldFor,
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
            {heldUpgradeInputs.length > 0 && (
              /* Not a live region: the funds half already announces through the pad line. */
              <UpgradesHeld>
                {`Upgrades held: ${heldUpgradeInputs.join(" and ")} no longer current`}
              </UpgradesHeld>
            )}
            {tierSpecsFit && answeredFacilities.length > 0 && !anyTierText && (
              /* Said once for the grid, and not at all when no facility answered. */
              <AbsenceLine>No tier detail</AbsenceLine>
            )}
            {tiersHeldFor !== undefined && answeredFacilities.length > 0 && (
              /* A held reading says when it was taken. Not a live region: the age changes every frame. */
              <ReadoutCaption>
                Tiers read <Unit value={tiersHeldFor} /> ago
              </ReadoutCaption>
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
