import type { ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  getContributionsForSlot,
  registerComponent,
  useGameContext,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  META_VANTAGE,
  type SpaceCenterState,
  useCommand,
  useStream,
} from "@ksp-gonogo/sitrep-client";
import { readingOf, stillTrue } from "@ksp-gonogo/sitrep-sdk";
import { useContributions } from "@ksp-gonogo/ui-kit";
import { magnitudeOf } from "../shared/magnitude";
import { facilityLevelsFrom } from "./facilities";
// Imported for its registration side effect too; the age caption is only honest while that contribution is on screen.
import { STOCK_FACILITY_CONTRIBUTION_ID } from "./facilitiesContribution";
import "./slots";
import { SpaceCenterStatusView } from "./SpaceCenterStatusView";

const topics = defineTopicManifest({
  channels: [
    "career.status",
    "career.facilities",
    "spaceCenter.scene",
    "spaceCenter.state",
  ],
  fields: [
    "career.facilities.facilities",
    "career.status.balances.funds",
    "spaceCenter.scene.launchSite",
    "spaceCenter.state.padOccupied",
    "spaceCenter.state.padVesselTitle",
  ],
});

type SpaceCenterStatusConfig = Record<string, never>;

function SpaceCenterStatusComponent({
  w,
  h,
}: Readonly<ComponentProps<SpaceCenterStatusConfig>>) {
  const careerReading = useTelemetry("career.status");
  // Read for its currency only, to date the grid: values arrive through the contribution slot's payload-only compute.
  const facilitiesReading = useTelemetry("career.facilities");
  const careerFunds = magnitudeOf(
    careerReading.state === "observed"
      ? careerReading.value.balances?.funds
      : undefined,
  );
  const fundsHeld = careerReading.state === "held";
  // "Held" only when a balance actually arrived and is being refused.
  const heldFunds =
    fundsHeld &&
    magnitudeOf(stillTrue(careerReading, undefined)?.balances?.funds) !== null;
  // The balance on screen, marked by Unit while held; affordability reads only the current `careerFunds`.
  const fundsReading = readingOf(
    careerReading,
    (c) => c.balances?.funds ?? undefined,
  );
  const { chargesFunds } = useGameContext();
  const sceneReading = useTelemetry("spaceCenter.scene");
  // The site changes only when a vessel launches from it, so the last one reported is still the answer.
  const launchSite = stillTrue(sceneReading, undefined)?.launchSite;
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
  // The gate's own refusal outranks any affordability verdict; a career mod may queue a tier and bill it as it builds, so a shortfall slows it rather than blocking it, and `undetermined` is not a block.
  const upgradeBlocked = upgradeCmd.gate?.blocked === true;

  // Whichever contribution won the slot; the widget's own reading sits at the band every other contributor outranks.
  const facilities = facilityLevelsFrom(
    useContributions("space-center-status.facilities"),
  );
  const stockHoldsTheGrid = getContributionsForSlot(
    "space-center-status.facilities",
  ).some((def) => def.id === STOCK_FACILITY_CONTRIBUTION_ID);
  // Marked only while the stock contribution holds the winning band, so a live contributor's grid is never marked by the stock channel's staleness.
  const tiersHeldSince =
    stockHoldsTheGrid && facilitiesReading.state === "held"
      ? { asOfUt: facilitiesReading.asOfUt, grade: facilitiesReading.grade }
      : null;

  // Announced through aria-live, so "No vehicle on pad" must never be reached from two absences.
  const padLine = describePad(padOccupied, padVesselTitle, launchSite);

  return (
    <SpaceCenterStatusView
      w={w}
      h={h}
      careerFunds={careerFunds}
      heldFunds={heldFunds}
      fundsReading={fundsReading}
      chargesFunds={chargesFunds}
      padOccupied={padOccupied}
      padLine={padLine}
      tiersHeldSince={tiersHeldSince}
      facilities={facilities}
      upgradeBlocked={upgradeBlocked}
      upgradeCmd={upgradeCmd}
    />
  );
}

function describePad(
  padOccupied: boolean | null | undefined,
  padVesselTitle: string | undefined,
  launchSite: string | null | undefined,
): string {
  if (padOccupied === undefined || padOccupied === null)
    return "Pad state unknown";
  if (padOccupied) {
    if (padVesselTitle) return `On pad: ${padVesselTitle}`;
    return "Vehicle on pad";
  }
  if (launchSite) return `Last site: ${launchSite}`;
  return "No vehicle on pad";
}

registerComponent<SpaceCenterStatusConfig>({
  id: "space-center-status",
  name: "Space Center Status",
  description:
    "KSC overview: facility levels (VAB, SPH, R&D, ...), launch-pad state, and arm-then-confirm upgrade buttons per facility.",
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
