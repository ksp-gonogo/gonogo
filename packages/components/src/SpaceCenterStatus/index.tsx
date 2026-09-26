import type { ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  formatCompactCurrency,
  getContributionsForSlot,
  getSizeBucket,
  registerComponent,
  useGameContext,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  META_VANTAGE,
  observedAt,
  type SpaceCenterState,
  useCommand,
  useStream,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import { stillTrue, value } from "@ksp-gonogo/sitrep-sdk";
import {
  AutoEmptyState,
  CheckIcon,
  ChevronUpIcon,
  type CommandButtonHandle,
  commandLossSentence,
  EmptyState,
  FitLabelButton,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  Row,
  Section,
  Spinner,
  Stack,
  speakQuantity,
  Text,
  Unit,
  useCommandButton,
  useContributions,
  usePanelDelay,
  WidgetSections,
} from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import {
  FundsDrain,
  netFundsPerDay,
  reportsFundsDrain,
} from "../shared/FundsDrain";
import { magnitudeOf } from "../shared/magnitude";
import {
  FACILITIES,
  type FacilityLevel,
  facilityLevelsFrom,
  KEY_TO_ENUM_FACILITY,
} from "./facilities";
// Imported for its registration side effect too; the age caption is only honest while that contribution is on screen.
import { STOCK_FACILITY_CONTRIBUTION_ID } from "./facilitiesContribution";
import { parseLevelText } from "./levelText";

const topics = defineTopicManifest({
  channels: [
    "career.status",
    "career.facilities",
    "spaceCenter.scene",
    "spaceCenter.state",
  ],
  fields: [
    "career.facilities.facilities",
    "career.status.economy.funds",
    "career.status.economy.subsidyPerDay",
    "career.status.economy.upkeepPerDay",
    "spaceCenter.scene.launchSite",
    "spaceCenter.scene.scene",
    "spaceCenter.state.padOccupied",
    "spaceCenter.state.padVesselTitle",
  ],
});

type SpaceCenterStatusConfig = Record<string, never>;

// `space-center-status.sections` appends extra facility-level rows to the body.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "space-center-status.sections": Record<string, never>;
  }
}

function SpaceCenterStatusComponent({
  w,
  h,
}: Readonly<ComponentProps<SpaceCenterStatusConfig>>) {
  /**
   * The balance authorises spending, so a held one is withheld rather than
   * shown: it is exactly the number that says yes to an upgrade the player can
   * no longer pay for.
   */
  const careerReading = useTelemetry("career.status");
  /**
   * Read for its CURRENCY only, to date the grid: the values arrive through the
   * contribution slot, whose `compute` sees payloads and never readings.
   */
  const facilitiesReading = useTelemetry("career.facilities");
  const careerEconomy =
    careerReading.state === "observed"
      ? careerReading.value.economy
      : undefined;
  const careerFunds = magnitudeOf(careerEconomy?.funds);
  const fundsNotCurrent = careerReading.state === "stale";
  // The standing per-day cost against a subsidy, from whichever money model won the `economy` capability; stock reports none.
  const netFunds = netFundsPerDay(careerEconomy);
  // "Held" only when a balance actually arrived and is being refused.
  const heldFunds =
    fundsNotCurrent &&
    magnitudeOf(stillTrue(careerReading, undefined)?.economy?.funds) !== null;
  const { chargesFunds } = useGameContext();
  const sceneReading = useTelemetry("spaceCenter.scene");
  // The site changes only when a vessel launches from it, so the last one reported is still the answer.
  const launchSite = stillTrue(sceneReading, undefined)?.launchSite;
  const scene =
    sceneReading.state === "observed" ? sceneReading.value.scene : undefined;
  const lastScene = stillTrue(sceneReading, undefined)?.scene;
  // The pad changes when a vessel rolls out or launches, so it holds like the site.
  const spaceCenterState = stillTrue(
    useStream<SpaceCenterState>("spaceCenter.state"),
    undefined,
  );
  const padOccupied = spaceCenterState?.padOccupied;
  const padVesselTitle = spaceCenterState?.padVesselTitle ?? undefined;
  // A KSC ground action with no vessel signal delay, so it dispatches at the meta-vantage.
  const upgradeCmd = useCommand("career.facility.upgrade", {
    vantage: META_VANTAGE,
  });
  usePanelDelay(upgradeCmd);
  /**
   * The game has already said it will refuse this command, which outranks any
   * affordability verdict. Under RP-1 a tier is queued as a construction project
   * billed as it builds, so a shortfall slows it rather than refusing it.
   * `undetermined` is not a block.
   */
  const upgradeBlocked = upgradeCmd.gate?.blocked === true;

  // Whichever contribution won the slot; the widget's own reading sits at the band every other contributor outranks.
  const facilities = facilityLevelsFrom(
    useContributions("space-center-status.facilities"),
  );
  /**
   * How old the tiers ON SCREEN are, and nothing when they are current. Only
   * while the stock contribution holds the winning band, so a live contributor's
   * grid is never dated with the stock channel's staleness. Clamped at zero.
   */
  const viewUt = useViewUt();
  const stockHoldsTheGrid = getContributionsForSlot(
    "space-center-status.facilities",
  ).some((def) => def.id === STOCK_FACILITY_CONTRIBUTION_ID);
  const tiersObservedUt = observedAt(facilitiesReading);
  const tiersHeldFor =
    stockHoldsTheGrid &&
    facilitiesReading.state === "stale" &&
    viewUt &&
    tiersObservedUt
      ? viewUt.minus(tiersObservedUt)
      : undefined;

  /**
   * Upgrades work in the Space Center scene only. An unknown or held scene
   * grants no permission to spend: the player may have walked out since.
   */
  const upgradesEnabled = scene === "SpaceCenter";
  // Cite the held scene only when withholding it actually disabled something.
  const heldScene =
    sceneReading.state === "stale" && lastScene === "SpaceCenter";
  const heldUpgradeInputs = [
    heldScene ? "scene" : undefined,
    heldFunds ? "funds balance" : undefined,
  ].filter((held): held is string => held !== undefined);

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

  // Announced through aria-live, so "No vehicle on pad" must never be reached from two absences.
  const padKnown = padOccupied !== undefined && padOccupied !== null;
  const padLine = !padKnown
    ? "Pad state unknown"
    : padOccupied
      ? padVesselTitle
        ? `On pad: ${padVesselTitle}`
        : "Vehicle on pad"
      : launchSite
        ? `Last site: ${launchSite}`
        : "No vehicle on pad";

  if (sizeBucket === "tiny") {
    return (
      <Panel
        panelTitle="KSC"
        fitToSize
        sections={
          <Section>
            {careerFunds !== null ? (
              <TinyFunds
                title={speakQuantity(value("funds", careerFunds), {
                  decimals: 0,
                })}
              >
                {formatTinyFunds(Math.round(careerFunds))}
                <TinyFundsUnit>f</TinyFundsUnit>
                {/* At this size the drain arrives as how long the balance lasts. */}
                {reportsFundsDrain(netFunds) && (
                  <TinyDrain>
                    <FundsDrain
                      funds={careerFunds}
                      netPerDay={netFunds}
                      compact
                    />
                  </TinyDrain>
                )}
              </TinyFunds>
            ) : (
              /* A held balance is titled and a never-arrived one is not, so the two are distinguishable. */
              <TinyFunds
                title={
                  heldFunds ? "Funds balance no longer current" : undefined
                }
              >
                {NULL_DISPLAY}
              </TinyFunds>
            )}
            <TinyPad
              $occupied={padOccupied === true}
              title={padLine}
              role="img"
              aria-label={padLine}
            >
              {/* "PAD CLEAR" is the same claim as the line above, in two words. */}
              {padOccupied === true
                ? "PAD ACTIVE"
                : padKnown
                  ? "PAD CLEAR"
                  : "PAD UNKNOWN"}
            </TinyPad>
          </Section>
        }
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
                {careerFunds !== null ? (
                  <FundsReadout title="Available funds">
                    · <Unit value={value("funds", careerFunds)} />
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
                  /* The balance is required beside a spend control; sandbox charges nothing. */
                  chargesFunds &&
                  (heldFunds ? (
                    <FundsReadout title="Funds balance no longer current">
                      · funds no longer current
                    </FundsReadout>
                  ) : (
                    <FundsReadout title="No funds balance has arrived">
                      · funds unknown
                    </FundsReadout>
                  ))}
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
                  {answeredFacilities.map(({ key, label }) => {
                    const f = facilities[key];
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
                    const canUpgrade =
                      upgradesEnabled &&
                      !!f &&
                      !atMax &&
                      f.upgradeFunds > 0 &&
                      canAfford;
                    // A blocked command is refused for a reason the balance has no part in, so the price is a plain figure.
                    const moneyDecides = !upgradeBlocked;
                    const tooltip = buildFacilityTooltip(label, f);
                    // Gated on the whole grid: a cell whose own description is empty still has to say so.
                    const showTierSpecs = tierSpecsFit && anyTierText && !!f;
                    // Only a facility with somewhere left to go owes a NEXT block; `max === 0` is an unknown ceiling.
                    const hasNextTier = !!f && f.max > 0 && !atMax;
                    return (
                      <FacilityCell key={key} title={tooltip || undefined}>
                        <FacilityLabel>{label}</FacilityLabel>
                        <FacilityValue
                          // So AT announces "Launch Pad tier 2 of 3" rather than the "2 / 3" spans as fragments.
                          role="img"
                          aria-label={
                            f && f.max > 0
                              ? `${label} tier ${displayLevel} of ${displayMax}`
                              : `${label} tier unknown`
                          }
                        >
                          {f && f.max > 0 ? (
                            <>
                              <Tier>{displayLevel}</Tier>
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
                              $afford={moneyDecides ? canAfford : true}
                              /* The verdict, observable from outside; absent when money decides nothing. */
                              data-afford={
                                moneyDecides
                                  ? canAfford
                                    ? "yes"
                                    : "no"
                                  : undefined
                              }
                            >
                              {formatCompactCurrency(f.upgradeFunds)}
                            </UpgradeCost>
                            <UpgradeButton
                              enabled={canUpgrade}
                              upgradeCmd={upgradeCmd}
                              facilityId={KEY_TO_ENUM_FACILITY[key]}
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
                            <TierBlock
                              heading="Now"
                              text={f.currentLevelText}
                            />
                            {hasNextTier && (
                              <TierBlock
                                heading="Next"
                                text={f.nextLevelText}
                              />
                            )}
                          </TierSpecs>
                        )}
                      </FacilityCell>
                    );
                  })}
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

/**
 * One tier's description as a list. The value stays a string: "140t" and
 * "Unlimited" are both legitimate settings of the same property.
 */
function TierBlock({ heading, text }: { heading: string; text: string }) {
  const specs = parseLevelText(text);
  return (
    <TierBlock__Root>
      <TierBlock__Heading>{heading}</TierBlock__Heading>
      {specs.length === 0 ? (
        <TierBlock__Absent>{NULL_DISPLAY}</TierBlock__Absent>
      ) : (
        <Stack as="ul" style={TIER_SPEC_LIST}>
          {specs.map((spec) =>
            spec.kind === "pair" ? (
              <Row key={spec.id}>
                <TierBlock__Label>{spec.label}</TierBlock__Label>
                <TierBlock__Value size="xs" tone="default">
                  {spec.value}
                </TierBlock__Value>
              </Row>
            ) : (
              <Row key={spec.id}>
                <TierBlock__Value size="xs" tone="default">
                  {spec.text}
                </TierBlock__Value>
              </Row>
            ),
          )}
        </Stack>
      )}
    </TierBlock__Root>
  );
}

/**
 * The facility cell's upgrade control. Behaviour is the shared
 * `useCommandButton`; the chrome is local because the label has to collapse
 * to an icon in a cell about two grid columns wide.
 */
function UpgradeButton({
  enabled,
  upgradeCmd,
  facilityId,
  facilityLabel,
  titleOverride,
}: {
  enabled: boolean;
  upgradeCmd: CommandButtonHandle;
  facilityId: string;
  facilityLabel: string;
  titleOverride?: string;
}) {
  const commandLabel = `Upgrade ${facilityLabel}`;
  const {
    isArmed,
    isBlocked,
    isPending,
    isRefused,
    isLost,
    refusalText,
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
      data-failed={hasFailure ? "true" : undefined}
      onClick={() => press(true)}
      title={titleOverride}
      label="Upgrade"
      icon={<ChevronUpIcon size={12} />}
    />
  );
}

// The current-tier text and next-tier preview, for the cell's native `title` tooltip.
function buildFacilityTooltip(label: string, f?: FacilityLevel): string {
  if (!f) return label;
  if (!f.currentLevelText && !f.nextLevelText) {
    return `${label} (no level descriptions on this telemetry)`;
  }
  const parts: string[] = [`${label}: tier ${f.level + 1} of ${f.max + 1}`];
  if (f.currentLevelText) {
    parts.push("", "NOW", plainTierSpecs(f.currentLevelText));
  }
  if (f.nextLevelText) {
    parts.push("", "NEXT", plainTierSpecs(f.nextLevelText));
  }
  return parts.join("\n");
}

/** The cell's tier lines flattened for a `title` attribute; a pair keeps its colon. */
function plainTierSpecs(text: string): string {
  return parseLevelText(text)
    .map((spec) =>
      spec.kind === "pair" ? `${spec.label}: ${spec.value}` : spec.text,
    )
    .join("\n");
}

// Whole-number k/M so the string stays 3-4 chars in the narrowest box; the full value is in `title`.
function formatTinyFunds(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${Math.round(value / 1_000)}k`;
  return value.toFixed(0);
}

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
`;

const FacilityGrid = styled.div<{ $compact: boolean }>`
  display: grid;
  grid-template-columns: ${(p) =>
    p.$compact ? "repeat(2, minmax(0, 1fr))" : "repeat(3, minmax(0, 1fr))"};
  gap: var(--gap-related);
`;

const FacilityCell = styled.div`
  display: flex;
  flex-direction: column;
  padding: var(--inset-surface);
  background: var(--color-surface-panel);
  border-radius: var(--radius-regular);
`;

const FacilityLabel = styled.span`
  font-size: var(--font-size-caption);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  /* Off the line-height scale: the min-height below is two of these lines, so the two move together. */
  line-height: 1.3;
  /* Every cell reserves two label lines, so the tier, cost and button line up across a row. */
  display: block;
  min-height: 2.6em;
`;

const FacilityValue = styled.span`
  font-size: var(--font-size-value);
  font-weight: 600;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
`;

const Tier = styled.span`
  color: var(--color-accent-fg);
`;

const Slash = styled.span`
  color: var(--color-text-faint);
  margin: 0 var(--gap-lead-figure);
`;

const TierMax = styled.span`
  color: var(--color-text-muted);
`;

const Muted = styled.span`
  color: var(--color-text-faint);
`;

const UpgradeRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-related);
  margin-top: var(--gap-actions);
  flex-wrap: wrap;
`;

const UpgradeCost = styled.span<{ $afford: boolean }>`
  font-size: var(--font-size-compact);
  /* The nogo bg token, not fg: fg is meant for the red fill and reads as ordinary copy on the dark cell. */
  color: ${(p) =>
    p.$afford ? "var(--color-accent-fg)" : "var(--color-status-nogo-bg)"};
  font-weight: ${(p) => (p.$afford ? "inherit" : "600")};
  font-variant-numeric: tabular-nums;
`;

const MaxBadge = styled.span`
  font-size: var(--font-size-caption);
  letter-spacing: 0.1em;
  color: var(--color-text-faint);
  text-transform: uppercase;
  margin-top: var(--gap-caption);
`;

const TierSpecs = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  margin-top: var(--gap-related-compact);
  padding-top: var(--inset-below-rule);
  border-top: 1px dashed var(--color-surface-raised);
`;

const TierBlock__Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const TierBlock__Heading = styled.span`
  font-size: var(--font-size-caption);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-faint);
`;

const TierBlock__Absent = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-faint);
`;

// Wraps rather than ellipsising: a cell is under 100px wide at the default size.
const TierBlock__Label = styled.span`
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
`;

// Breaking inside "Unlimited" beats spilling onto the facility beside it.
const TierBlock__Value = styled(Text)`
  min-width: 0;
  overflow-wrap: anywhere;
`;

const TIER_SPEC_LIST = { listStyle: "none", margin: 0, padding: 0 } as const;

const UpgradeButtonStyled = styled(FitLabelButton)`
  font-size: var(--font-size-compact);
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: var(--inset-control);
  border-radius: var(--radius-regular);
  border: 1px solid var(--color-surface-raised);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-family: inherit;
  text-align: center;
  /* Must shrink below its label so FitLabelButton can measure it and fall back to the icon. */
  min-width: 0;

  &:hover:not(:disabled):not([aria-disabled="true"]) {
    color: var(--color-accent-fg);
    border-color: var(--color-accent-fg);
  }

  /* A blocked control keeps its focus ring and answers a press with its reason, hence aria-disabled. */
  &:disabled,
  &[aria-disabled="true"] {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const ConfirmUpgradeButton = styled(UpgradeButtonStyled)`
  background: var(--color-status-go-bg);
  color: var(--color-status-go-fg);
  border-color: transparent;
  /* The animation lives inside the same reduced-motion guard as its keyframes. */
  @media (prefers-reduced-motion: no-preference) {
    /* An attention pulse, not a UI transition, so off the duration scale. */
    animation: upgradePulse 1s var(--ease-emphasis) infinite;
    @keyframes upgradePulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.6;
      }
    }
  }
`;

const PadStatusLine = styled.span`
  font-size: var(--font-size-caption);
  color: var(--color-text-muted);
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
`;

const UpgradesHeld = styled.span`
  font-size: var(--font-size-compact);
  letter-spacing: 0.04em;
  /* Warning text on a dark surface, the same treatment as UpgradeCost when unaffordable. */
  color: var(--color-status-nogo-bg);
  font-weight: 600;
`;

const AbsenceLine = styled.span`
  font-size: var(--font-size-caption);
  letter-spacing: 0.04em;
  color: var(--color-text-faint);
`;

const FundsReadout = styled.span`
  color: var(--color-status-go-fg);
  font-variant-numeric: tabular-nums;
  margin-left: var(--gap-lead-figure);
`;

const DrainReadout = styled.span`
  margin-left: var(--gap-lead-figure);
`;

const TinyFunds = styled.div`
  /* Fluid, so off the type scale: the compact value must still fit the 2x3 minimum size. */
  font-size: clamp(12px, 13cqw, 22px);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--color-status-go-fg);
  line-height: var(--line-height-flush);
  max-width: 100%;
  white-space: nowrap;
`;

const TinyFundsUnit = styled.span`
  /* Off the type scale: the suffix must not out-size the balance, which is pinned at 12px at the minimum size. */
  font-size: 12px;
  color: var(--color-text-muted);
  margin-left: var(--gap-unit-suffix);
`;

const TinyDrain = styled.div`
  /* The smallest rung: a qualifier must not out-size the balance it qualifies. */
  font-size: var(--font-size-compact);
  font-weight: 400;
  line-height: var(--line-height-flush);
`;

const TinyPad = styled.span<{ $occupied: boolean }>`
  font-size: var(--font-size-caption);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${(p) =>
    p.$occupied ? "var(--color-accent-fg)" : "var(--color-text-faint)"};
`;

registerComponent<SpaceCenterStatusConfig>({
  id: "space-center-status",
  name: "Space Center Status",
  description:
    "KSC overview: facility levels (VAB, SPH, R&D, ...), launch-pad state, and arm-then-confirm upgrade buttons per facility (only enabled in the Space Center scene; disabled when funds are short or the facility is at max).",
  tags: ["career", "kc"],
  defaultSize: { w: 6, h: 7 },
  minSize: { w: 2, h: 3 },
  component: SpaceCenterStatusComponent,
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: {},
  actions: [],
  augmentSlots: ["space-center-status.sections"],
  contributionSlots: ["space-center-status.facilities"],
  pushable: true,
});

export { FACILITY_ORDINAL_KEYS, parseFacilityLevels } from "./facilities";
export { SpaceCenterStatusComponent };
