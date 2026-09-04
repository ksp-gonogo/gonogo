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
  type Reading,
  type SpaceCenterState,
  useCommand,
  useStream,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  AutoEmptyState,
  CheckIcon,
  ChevronUpIcon,
  type CommandButtonHandle,
  commandLossSentence,
  EmptyState,
  FitLabelButton,
  formatDuration,
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
// The widget's own reading of `career.facilities`, contributed into its own grid
// at the band every other contributor outranks. Imported for the id as well as
// for the registration side effect: the age caption below is only honest while
// this is the contribution on screen.
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

// `space-center-status.sections` appends extra facility-level rows to the body,
// for a KSC-expansion Uplink's custom facilities or a ground-based life-support
// depot. A plain marker carrying no slot props. The `SlotRegistry` merge is
// co-located per widget so parallel slot work never collides on one shared file.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "space-center-status.sections": Record<string, never>;
  }
}

/**
 * The value a VERDICT may be drawn from: current, or modelled forward to the frame.
 * A stale reading gives nothing, because a judgement cannot be dated: the operator
 * reads a band or a pill as the situation NOW.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

/** Whether a reading went stale, as opposed to never having arrived. */
function notCurrent<T>(reading: Reading<T>): boolean {
  return reading.state === "stale";
}

/**
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
function stillTrue<T, A>(
  reading: Reading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "reckonable") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

function SpaceCenterStatusComponent({
  w,
  h,
}: Readonly<ComponentProps<SpaceCenterStatusConfig>>) {
  // Canonical Topic reads (former kc.*/career.* keys resolved
  // through map-topic.ts):
  //  - kc.facilityLevels -> career.facilities, read through the
  //    `space-center-status.facilities` contribution slot rather than here.
  //  - career.funds -> career.status.economy.funds.
  //  - kc.scene / kc.launchSite -> spaceCenter.scene.{scene,launchSite}
  //    (plain fields on the one SpaceCenterScene Topic).
  //  - kc.padOccupied / kc.padVesselTitle -> the DERIVED spaceCenter.state
  //    channel (space-center-state.ts, off spaceCenter.launchSites): read
  //    via useStream, not a canonical one-arg Topic read.
  // kc.upgradeFacility[...] (the spend command) still has no command home
  // (KNOWN_COMMAND_GAPS) and falls back to legacy execute automatically,
  // reads migrate first, commands come later.
  /**
   * The balance is not a fact. It moves on its own (contract payouts, a
   * recovery, a spend made elsewhere), and here it authorises spending:
   * `canAfford` below is a verdict that arms a button. A held number is exactly
   * the one that says yes to an upgrade the player can no longer pay for, so it
   * is withheld, and `fundsNotCurrent` lets the widget say which of the two
   * reasons the balance is missing for.
   *
   * The facility tiers are a different kind of thing and ride a different
   * channel for it: see `facilitiesReading` below.
   */
  const careerReading = useTelemetry("career.status");
  /**
   * The tiers' own channel, read here for its CURRENCY only. The values reach
   * the grid through the contribution slot below; this read exists so the grid
   * can be dated.
   *
   * KSP can only answer a facility's tier count from the live building objects,
   * which exist at the space centre, in the editor and in flight near the KSC.
   * Everywhere else there is nothing to read, so the channel goes quiet rather
   * than reporting nulls, and this read lands on the `stale` arm carrying the
   * last real observation and the UT it was made at. A tier count does not
   * change during a save, so that reading is still true; what it needs is a
   * date.
   *
   * The contribution cannot supply that date itself. A contribution's `compute`
   * is fed topic PAYLOADS, never the readings behind them, so what it samples
   * off a quiet channel is the last real value with nothing to say it is old.
   * The two halves meet here.
   */
  const facilitiesReading = useTelemetry("career.facilities");
  // Magnitude: compared against an upgrade cost and rendered through this
  // widget's own compact funds formatting, both of which want a number.
  const careerFunds = magnitudeOf(judgeable(careerReading)?.economy?.funds);
  const fundsNotCurrent = notCurrent(careerReading);
  /**
   * A balance is only half of what "can I afford this" asks. Under a career
   * overhaul the programme runs a standing per-day cost against a subsidy, so a
   * balance that covers an upgrade today need not cover it and next month's
   * payroll. This is the other half, and it comes from whichever money model
   * won the `economy` capability rather than from arithmetic invented here, so
   * a stock career reports no such mechanism and this shows nothing at all.
   */
  const netFunds = netFundsPerDay(judgeable(careerReading)?.economy);
  // Only claim a balance is being held when one actually arrived and is being
  // refused. A career that never reported an `economy` block has nothing held.
  const heldFunds =
    fundsNotCurrent &&
    magnitudeOf(stillTrue(careerReading, undefined)?.economy?.funds) !== null;
  const { chargesFunds } = useGameContext();
  const sceneReading = useTelemetry("spaceCenter.scene");
  // "Last site" is a claim about the past by construction: the site changes when
  // a vessel launches from it, so the last one reported is still the answer.
  const launchSite = stillTrue(sceneReading, undefined)?.launchSite;
  const scene = judgeable(sceneReading)?.scene;
  const lastScene = stillTrue(sceneReading, undefined)?.scene;
  const spaceCenterState = useStream<SpaceCenterState>("spaceCenter.state");
  const padOccupied = spaceCenterState?.padOccupied;
  const padVesselTitle = spaceCenterState?.padVesselTitle ?? undefined;
  // Facility upgrades are a KSC ground action with no vessel signal delay, so
  // they dispatch at the meta-vantage (instant). The handle is contributed to
  // the panel's delay rail by usePanelDelay below.
  const upgradeCmd = useCommand("career.facility.upgrade", {
    vantage: META_VANTAGE,
  });
  usePanelDelay(upgradeCmd);
  /**
   * The game has already said it will refuse this command, and that outranks
   * everything this widget works out about the balance.
   *
   * A career overhaul is where it bites, and RP-1 is the shipped case:
   * `Rp1CareerProjectGate` blocks `career.facility.upgrade` outright, because
   * under RP-1 a tier is not for sale. It is queued as a construction project,
   * and `ConstructionProject.AddProgress` bills that AS IT BUILDS, spending
   * whatever fraction of a tick the career can meet
   * (`CurrencyUtils.GetAffordableFundsFraction`, read off the shipped RP-1
   * v4.6.0.0 RP0.dll). A short career gets a SLOWER upgrade, never a refused
   * one, so a shortfall drawn over that price tells the operator they cannot
   * afford a tier RP-1 would have built for them.
   *
   * `undetermined` is deliberately not this. An authority that could not be
   * asked is not the game's judgement, and silencing the verdict on it would
   * take the honest one away from the stock career too.
   */
  const upgradeBlocked = upgradeCmd.gate?.blocked === true;

  /**
   * The grid's tiers, from whichever contribution won the slot rather than
   * straight off a channel. The widget's own reading is one of the contributions
   * (`./facilitiesContribution.ts`), registered at the band every other
   * contributor outranks, so a career model that reads a tier LIVE where the
   * stock channel can only hold its last one takes the grid over rather than
   * repeating it below.
   */
  const facilities = facilityLevelsFrom(
    useContributions("space-center-status.facilities"),
  );
  /**
   * How old the tiers ON SCREEN are, and nothing when they are current.
   *
   * Gated on the stock contribution actually holding the winning band, which is
   * the whole reason this is not simply the age of `career.facilities`. The grid
   * belongs to whoever won the slot; captioning it with a channel that lost
   * would date a live reading with someone else's staleness, which is the exact
   * failure the staleness type exists to prevent. `getContributionsForSlot`
   * already answers with the winning band only, and the `useContributions` above
   * subscribes to the registry, so this read is on the same frame as the grid it
   * describes.
   *
   * Clamped at zero: samples arrive out of order, so one can sit marginally
   * ahead of the frame, and "-0.4 s ago" is never a thing to render.
   */
  const viewUt = useViewUt();
  const stockHoldsTheGrid = getContributionsForSlot(
    "space-center-status.facilities",
  ).some((def) => def.id === STOCK_FACILITY_CONTRIBUTION_ID);
  const tiersObservedUt = observedAt(facilitiesReading);
  const tiersHeldForSec =
    stockHoldsTheGrid &&
    notCurrent(facilitiesReading) &&
    viewUt &&
    tiersObservedUt
      ? Math.max(0, viewUt.minus(tiersObservedUt).magnitude)
      : undefined;

  /**
   * Upgrades work in the Space Center scene only, KSP's upgrade pipeline isn't
   * safe to drive from elsewhere.
   *
   * An unknown scene does NOT enable them, however tempting the "it just means
   * telemetry warmup, show the affordance immediately" reading is. That grants
   * permission to spend from not knowing where the player is, and it reads the
   * same on a dropped frame mid-session as on first paint. No scene means no
   * permission.
   *
   * Which is why the scene reads through `judgeable` while the launch site beside
   * it on the same record does not. The site is something this widget reports; the
   * scene is nothing but a permission to spend, and a held scene is precisely "we
   * do not know where the player is now". They may have walked out of the Space
   * Center since. So a scene that is no longer current means no permission either,
   * and `heldScene` names that on screen so a row of dead buttons is not mistaken
   * for a KSC with nothing left to upgrade.
   */
  const upgradesEnabled = scene === "SpaceCenter";
  // Cite the scene only when withholding it actually cost the operator the
  // affordance. A held "Flight" disables nothing that was ever enabled.
  const heldScene = notCurrent(sceneReading) && lastScene === "SpaceCenter";
  const heldUpgradeInputs = [
    heldScene ? "scene" : undefined,
    heldFunds ? "funds balance" : undefined,
  ].filter((held): held is string => held !== undefined);

  const cols = w ?? 6;
  const rows = h ?? 8;
  const showSubtitle = rows >= 4;
  // 3-col grid only when the widget is wide enough for each cell to hold a
  // facility name, its tier and its upgrade cost without clipping. At width 5
  // (e.g. the tall-narrow portrait aspect) three columns squeeze each cell to
  // ~115px and the facility names wrap into ribbons; two columns hold them.
  const compactGrid = cols < 6;
  /**
   * The tier lists need more width than the grid does. Three columns of a
   * 6-wide widget are about 60px of usable cell, and "Unlimited" is one
   * unbreakable word wider than that: the list lands on top of the facility
   * beside it. Nine columns give roughly 90px, where a property and its
   * setting sit on one line. Below that the cell keeps the tier and the cost,
   * which is what the upgrade decision turns on, and the descriptions stay
   * reachable through the cell's hover tooltip.
   */
  const tierSpecsFit = cols >= 9;
  const sizeBucket = getSizeBucket(w, h);
  /**
   * Whether ANY facility described its tiers. A producer either emits these
   * for every facility or for none, so nothing tells the operator apart the
   * two silences at cell level: a facility that happens to have nothing to say
   * and a build that never says anything. Answering it once for the grid lets
   * a whole-grid silence be stated as one line, and leaves a lone empty cell
   * inside an otherwise-populated grid to show its own explicit absence.
   */
  const anyTierText = FACILITIES.some(({ key }) => {
    const f = facilities[key];
    return !!f && (f.currentLevelText !== "" || f.nextLevelText !== "");
  });

  /**
   * The facilities that answered. A facility whose tiers did not arrive is not
   * a facility at tier 0: `parseFacilityLevels` only admits an entry once both
   * ends of the pair are present, so anything that reaches this list has a
   * reading to show, including a building sitting at the bottom of its ladder
   * and one already at its ceiling.
   *
   * <para>Filtered rather than drawn as nine cells with the missing ones
   * dashed, and the same argument the tier descriptions above already make:
   * a non-answer written out nine times is one fact reported nine ways, and it
   * buried the four buildings that did answer. The wire cannot in fact produce
   * a mixed grid, `BuildCareerFacilities` reaches every facility through the
   * same `protoUpgradeables` registration and gets all nine or none, so a
   * partial grid is a producer this widget has not met; showing what it sent
   * and stating nothing about what it did not is the honest reading of one.</para>
   */
  const answeredFacilities = FACILITIES.filter(
    ({ key }) => facilities[key] !== undefined,
  );

  /**
   * "No vehicle on pad" is a claim about the pad, and this line is announced
   * through `aria-live="polite"`, so it must not be reached from two absences
   * (no `padOccupied` and no `launchSite`): that announces to a screen reader
   * something nobody has established.
   */
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
                {/* At this size the balance alone is the whole readout, so the
                drain has to arrive as the one number that changes the answer:
                how long the balance lasts. */}
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
              /* No room for a sentence in a 2x3 box, but the reason still has to
               leave the component: a held balance is titled, a balance that never
               arrived is not, so the two are distinguishable from outside. */
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
                  /* The balance is required beside a spend control, and an absent
                 balance is the state that rule exists for: it is exactly when
                 the affordability check below has nothing to judge against.
                 Sandbox charges nothing, so there is no balance to be missing.
                 Held and never-arrived are two different sentences: one accuses
                 the link, the other only reports a cold start. */
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
              /* Not a live region: the funds half of this already re-announces
             through the pad line above, and telling the operator twice in one
             frame is how a status line gets ignored. */
              <UpgradesHeld>
                {`Upgrades held: ${heldUpgradeInputs.join(" and ")} no longer current`}
              </UpgradesHeld>
            )}
            {tierSpecsFit && answeredFacilities.length > 0 && !anyTierText && (
              /* Said once for the grid, because it is one fact about the producer
             rather than nine about the facilities. Nine dashes down the cells
             would report the same silence nine times and bury the tiers.

             Not said at all when no facility answered: descriptions of tiers
             that never arrived are not a second thing missing, and the marker
             below already reports the one that is. */
              <AbsenceLine>No tier detail</AbsenceLine>
            )}
            {tiersHeldForSec !== undefined && answeredFacilities.length > 0 && (
              /* The grid keeps its tiers when the channel stops arriving, and a
                 reading that is being held has to say when it was taken or it
                 reads as the state of the space centre now. A duration rather
                 than a caveat: the count itself does not move at all, and what
                 the operator judges is the tier they may have bought since.

                 Not a live region, and the age is why: it grows every frame, so
                 announcing it would read one fact out over and over. The pad
                 line above is this widget's only live region. */
              <ReadoutCaption>
                {`Tiers read ${formatDuration(tiersHeldForSec)} ago`}
              </ReadoutCaption>
            )}
            {/* ONE absence marker for the whole facilities area, and the area is
                the grid plus whatever an Uplink appends below it.

                The grid cannot simply vanish: a widget with no facilities in it
                and a widget that failed to draw look the same, and an operator
                away from the space centre is in that state for most of a
                session. But the marker used to be keyed on THIS widget's own
                channel, which reads the live `UpgradeableFacility` objects KSP
                instantiates at the space centre only. RP-1 reads the same tiers
                out of its own config in every scene, so an operator flying an
                RP-1 career was shown "no facility tiers" directly above a list
                of their facility tiers. Keyed on whether the area drew anything
                at all, a section that answered takes the marker off screen and
                the widget stops contradicting its own augment. */}
            <AutoEmptyState
              gap="md"
              fallback={<EmptyState>No facility tiers</EmptyState>}
            >
              {answeredFacilities.length > 0 && (
                <FacilityGrid $compact={compactGrid}>
                  {answeredFacilities.map(({ key, label }) => {
                    const f = facilities[key];
                    // Live curl 2026-05-13 confirmed: the fork's `max` field is the
                    // upgrade-count (KSP's `GetFacilityLevelCount`), not the
                    // tier-count. VAB returns `{level:2, max:2}` at full tier 3,
                    // launchPad returns `{level:1, max:2}` at tier 2. So the total
                    // number of tiers is `max + 1` and the operator-facing "Lvl N
                    // of M" should read `{level+1}/{max+1}`, matches KSP's stock
                    // R&D dialog which calls VAB tier 3 "Level 3".
                    const atMax = !!f && f.max > 0 && f.level >= f.max;
                    const displayLevel = f ? f.level + 1 : 0;
                    const displayMax = f && f.max > 0 ? f.max + 1 : 0;
                    // An absent balance must NOT satisfy this check. It guards a button
                    // that spends career funds, and not knowing the balance is not the
                    // same as knowing the upgrade is affordable.
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
                    /* Whether money is what decides this control at all. A blocked
                   command is refused for a reason the balance has no part in,
                   so there is no affordability verdict to draw and the price
                   goes back to being a plain figure: what it costs, which the
                   operator still needs beside the control. */
                    const moneyDecides = !upgradeBlocked;
                    // Build a hover-tooltip body summarising the current tier's
                    // bullet-list and (if available) the next-tier preview. The
                    // newlines from the fork stay as \n, the browser's `title`
                    // attribute renders them with native multi-line wrapping in
                    // the OS-level tooltip on every major platform.
                    const tooltip = buildFacilityTooltip(label, f);
                    // Gated on the whole grid rather than this one facility: a cell
                    // whose own description is empty still has to say so, and it can
                    // only say so inside a section that is on screen.
                    const showTierSpecs = tierSpecsFit && anyTierText && !!f;
                    // A tier the operator has already bought past is not missing, so
                    // only a facility with somewhere left to go owes a NEXT block. An
                    // unknown ceiling (`max === 0`) is not a claim that one exists.
                    const hasNextTier = !!f && f.max > 0 && !atMax;
                    return (
                      <FacilityCell key={key} title={tooltip || undefined}>
                        <FacilityLabel>{label}</FacilityLabel>
                        <FacilityValue
                          // role="img" + aria-label so AT announces a coherent
                          // "Launch Pad tier 2 of 3" instead of the "2 / 3" spans
                          // read as fragments (and makes aria-label valid on the
                          // otherwise-roleless value container).
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
                              /* The verdict, reported so it can be seen from
                             outside: it is otherwise a colour, and a colour is
                             a claim nothing can assert against. Absent when
                             money decides nothing, which is the whole of the
                             difference this attribute exists to hold. */
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

              {/* Appended to the facility-level list: a KSC-expansion Uplink can
              render extra facility rows here. Placed rather than left to
              `Panel`'s end-of-body default so the sections sit under the
              facilities they extend rather than under the body's own padding,
              and INSIDE the marker's content area so a section that draws tiers
              answers the absence above. */}
              <WidgetSections />
            </AutoEmptyState>
          </Body>
        </Section>
      }
    />
  );
}

/**
 * One tier's description, as a list rather than as the game's own bulleted
 * blob. A property line becomes a label and a value; anything else becomes a
 * plain line carrying exactly what arrived.
 *
 * The value stays a string. It is game copy, so "140t" and "Unlimited" are
 * both legitimate settings of the same property, and reading a magnitude out
 * of the first would leave the second with nowhere to go.
 */
function TierBlock({ heading, text }: { heading: string; text: string }) {
  const specs = parseLevelText(text);
  return (
    <TierBlock__Root>
      <TierBlock__Heading>{heading}</TierBlock__Heading>
      {specs.length === 0 ? (
        <TierBlock__Absent>{NULL_DISPLAY}</TierBlock__Absent>
      ) : (
        <Stack gap="xs" as="ul" style={TIER_SPEC_LIST}>
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
 * The facility cell's upgrade control. Behaviour (arm, confirm, in-flight,
 * refused, no reply) is the shared `useCommandButton`; the CHROME stays local because a
 * facility cell is roughly two grid columns wide and the label has to collapse
 * to an icon, which is `FitLabelButton`'s measured job and not something the
 * default `CommandButton` rendering does.
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
    // Not the resting render, which is what a CONFIRMED upgrade returns to: an
    // upgrade nobody answered may or may not be building.
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
    /* The mod said no before anyone pressed, so the control says why. A dark
       button with nothing on it reads the same as a fully-upgraded facility
       and the same as a short balance, and only one of the three is what
       happened here.

       `aria-disabled` and NOT `disabled`, the ruling CommandButton's own
       blocked phase sets out: a disabled button is dropped from some screen
       readers' walk entirely, and a gate verdict is advice rather than
       permission, since it is sampled and the dispatch re-evaluates anyway.
       The sentence travels in `title` and in the accessible name rather than in
       the button's body, because a facility cell is about two grid columns wide
       and `FitLabelButton` collapses a word that does not fit to an icon. */
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

// Multi-line tooltip body shown on cell hover. Combines current-tier
// text with next-tier preview (when not at max) so the operator can
// compare without opening anything. The browser renders \n natively
// in title attributes on every major platform.
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

/**
 * The same lines the cell lays out, flattened for a `title` attribute, which
 * gets plain text and one newline per line and nothing else. A property line
 * keeps its colon because that is what makes it read as a pair without the
 * column the cell can give it.
 */
function plainTierSpecs(text: string): string {
  return parseLevelText(text)
    .map((spec) =>
      spec.kind === "pair" ? `${spec.label}: ${spec.value}` : spec.text,
    )
    .join("\n");
}

// Compact funds for the tiny (2x3) bucket where the box is only ~2 grid
// columns wide. Drops to whole-number k/M so the string stays 3-4 chars
// ("290k", "78k", "13k"): the decimal form ("289.8k") overflows the
// narrowest box. The full value lives in the cell's `title` attribute.
function formatTinyFunds(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${Math.round(value / 1_000)}k`;
  return value.toFixed(0);
}

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-10);
`;

const FacilityGrid = styled.div<{ $compact: boolean }>`
  display: grid;
  grid-template-columns: ${(p) =>
    p.$compact ? "repeat(2, minmax(0, 1fr))" : "repeat(3, minmax(0, 1fr))"};
  gap: var(--space-6);
`;

const FacilityCell = styled.div`
  display: flex;
  flex-direction: column;
  padding: var(--space-6) var(--space-8);
  background: var(--color-surface-panel);
  border-radius: var(--radius-xs);
`;

const FacilityLabel = styled.span`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  /* Off the line-height scale: 1.3 and the min-height below it are one
     value written twice (2.6em = 2 x 1.3), a hand-computed two-line
     reserve. --line-height-body (1.4) would need the reserve at 2.8em, and
     moving one without the other brings the button-misalignment bug the
     comment below records straight back. */
  line-height: 1.3;
  /* Reserve room for a two-line wrap (e.g. "Launch Pad" / "Mission
     Control" at the narrow default-6x7 3-col grid) on every cell, not
     just the ones that need it. Without this, a facility with a
     short one-line label (Runway, VAB) sits higher in its cell than
     its row-mate with a two-line label (Launch Pad), everything
     below (tier value, cost, Upgrade button) inherits the offset, so
     the Upgrade buttons across a row land at visibly different
     heights even though each button box itself is the same size. */
  display: block;
  min-height: 2.6em;
`;

const FacilityValue = styled.span`
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
`;

const Tier = styled.span`
  color: var(--color-accent-fg);
`;

const Slash = styled.span`
  color: var(--color-text-faint);
  margin: 0 var(--space-2);
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
  gap: var(--space-6);
  margin-top: var(--space-4);
  /* Allow the Upgrade button to wrap to a new line when the grid cell
     is too narrow for cost + button side-by-side (default-6x7 at
     3-col grid gives ~62 px per cell, not enough for both). The
     button keeps its full label and stacks below the cost label. */
  flex-wrap: wrap;
`;

const UpgradeCost = styled.span<{ $afford: boolean }>`
  font-size: var(--font-size-2xs);
  /* Unaffordable cost must read as a nogo signal on the dark panel cell.
     The nogo *-fg token is the foreground meant to sit on the red *-bg
     fill: as standalone text on the near-black cell it's a pale pink that
     reads like ordinary light copy and the warning is lost. Use the
     saturated nogo *-bg token as the text colour instead, the established
     "nogo text on a dark surface" treatment (PerfBudgets, Twr, ShipMap)
     with adequate contrast. */
  color: ${(p) =>
    p.$afford ? "var(--color-accent-fg)" : "var(--color-status-nogo-bg)"};
  font-weight: ${(p) => (p.$afford ? "inherit" : "600")};
  font-variant-numeric: tabular-nums;
`;

const MaxBadge = styled.span`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.1em;
  color: var(--color-text-faint);
  text-transform: uppercase;
  margin-top: var(--space-2);
`;

const TierSpecs = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  margin-top: var(--space-6);
  padding-top: var(--space-6);
  border-top: 1px dashed var(--color-surface-raised);
`;

const TierBlock__Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
`;

const TierBlock__Heading = styled.span`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-faint);
`;

const TierBlock__Absent = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
`;

/* Wraps rather than ellipsising, which is why this is not `RowName`: a facility
   cell is under 100px wide at the widget's own default size, and "Max Active
   Strategies" fits one line of it at no size worth reading. A rung below the
   value it names, so the setting is the half that carries. */
const TierBlock__Label = styled.span`
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-2xs);
  color: var(--color-text-muted);
`;

/* "Unlimited" is one unbreakable word and a facility cell is narrow, so the
   last resort is to break inside it. Spilling past the cell edge puts the
   value on top of the facility beside it, which is the one outcome worse than
   an ugly break. */
const TierBlock__Value = styled(Text)`
  min-width: 0;
  overflow-wrap: anywhere;
`;

const TIER_SPEC_LIST = { listStyle: "none", margin: 0, padding: 0 } as const;

const UpgradeButtonStyled = styled(FitLabelButton)`
  font-size: var(--font-size-2xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: var(--space-2) var(--space-6);
  border-radius: var(--radius-xs);
  border: 1px solid var(--color-surface-raised);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-family: inherit;
  text-align: center;
  /* At the narrow default-6x7 3-col grid the facility cell interior is
     only ~46px: narrower than "Upgrade" can render on one line. A
     fixed nowrap width refuses to shrink, so the button keeps its full
     intrinsic width and overflows the cell (and, for the last column,
     right past the panel's own padding, reading as a "cut off"
     button).

     Letting it wrap keeps every character but breaks the word
     mid-syllable, "Upgra / de". FitLabelButton measures the label
     against the box and shows an icon when the word does not fit, so
     nothing is hyphenated and nothing overflows. It still has to
     shrink for that measurement to mean anything. */
  min-width: 0;

  &:hover:not(:disabled):not([aria-disabled="true"]) {
    color: var(--color-accent-fg);
    border-color: var(--color-accent-fg);
  }

  /* A blocked control looks the same as a dead one and behaves differently:
     it keeps its focus ring and answers a press with its reason, which is why
     it carries aria-disabled rather than disabled. */
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
  /* The animation property must live inside the same media guard as
     the keyframes: the bare property outside the guard fires for
     reduced-motion users (CLAUDE.md a11y rule). */
  @media (prefers-reduced-motion: no-preference) {
    /* 1s stays literal: an attention pulse, not a UI transition. */
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
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
`;

const UpgradesHeld = styled.span`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.04em;
  /* Same "warning text on a dark surface" treatment as UpgradeCost's
     unaffordable state: the nogo *-fg token is meant to sit on the red fill and
     reads as ordinary light copy standing alone on the panel. */
  color: var(--color-status-nogo-bg);
  font-weight: 600;
`;

const AbsenceLine = styled.span`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.04em;
  color: var(--color-text-faint);
`;

const FundsReadout = styled.span`
  color: var(--color-status-go-fg);
  font-variant-numeric: tabular-nums;
  margin-left: var(--space-2);
`;

/* Spacing only. The drain readout carries its own colour and its own break
   opportunities, so it needs no wrapper that decides either for it. */
const DrainReadout = styled.span`
  margin-left: var(--space-2);
`;

const TinyFunds = styled.div`
  /* Fluid size: large in a roomy "tiny" box (e.g. compact-4x7) but small
     enough that the abbreviated value (formatCompactCurrency → "290k") still fits the
     widget's 2x3 minSize floor (~110px wide) without clipping. Fluid, so
     off the fixed type scale by construction. */
  font-size: clamp(12px, 13cqw, 22px);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--color-status-go-fg);
  line-height: var(--line-height-flush);
  max-width: 100%;
  white-space: nowrap;
`;

const TinyFundsUnit = styled.span`
  /* Off the type scale: this sits beside TinyFunds' clamp above, which is
     pinned at its 12px floor at the 2x3 minSize. --font-size-sm is 13px on
     a coarse pointer, which would render the "f" suffix larger than the
     number it qualifies and eat the ~110px the value needs. */
  font-size: 12px;
  color: var(--color-text-muted);
  margin-left: var(--space-2);
`;

const TinyDrain = styled.div`
  /* Its own line under the balance. The smallest rung on the ladder, because at
     the 2x3 minSize the balance itself is pinned at its own floor and a
     qualifier must not out-size what it qualifies. */
  font-size: var(--font-size-2xs);
  font-weight: 400;
  line-height: var(--line-height-flush);
`;

const TinyPad = styled.span<{ $occupied: boolean }>`
  font-size: var(--font-size-2xs);
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

// The facility vocabulary moved to `./facilities.ts` so the built-in
// contribution can reach it without importing this component. Re-exported so
// this widget's tests keep their one import site.
export { FACILITY_ORDINAL_KEYS, parseFacilityLevels } from "./facilities";
export { SpaceCenterStatusComponent };
