import type { ComponentProps } from "@ksp-gonogo/sitrep-sdk";
import {
  registerComponent,
  registerDynamicTopicPrefix,
  stillTrue,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import { EmptyState, Panel, Section } from "@ksp-gonogo/ui-kit";
import { BREAKING_GROUND } from "../uplink";
import { DeployedStationCard } from "./DeployedStationCard";
import read from "./deployed-science.declarations.g";
import { type StationListing, stationsFromCatalog } from "./parseStation";

export type {
  DeployedExperiment,
  DeployedStation,
  StationListing,
} from "./parseStation";
export { parseStation, stationsFromCatalog } from "./parseStation";
export type { DeployedExperimentContext } from "./slots";

/** Each station publishes its own report, timed on its own link, under this prefix. */
registerDynamicTopicPrefix("deployed.station.");

/**
 * Every deployed Breaking Ground station the command centre knows of, with whether its science is reaching home, when it was last heard, its power balance and per-experiment science progress.
 * Read-only: deployed science auto-transmits and background stations cannot be actioned remotely.
 */
type DeployedScienceConfig = Record<string, never>;

function emptySentence(
  available: boolean | undefined,
  stations: StationListing[] | null,
): string {
  if (available === false) return "Breaking Ground not installed";
  if (stations === null) return "Waiting for the deployed-station roster";
  return "No deployed stations";
}

function DeployedScienceComponent(
  _: Readonly<ComponentProps<DeployedScienceConfig>>,
) {
  // The catalog is what the command centre knows of, a fact kept while held; each station's own report carries its own currency.
  const stations = stationsFromCatalog(
    stillTrue(useTelemetry("trackingStation.catalog"), undefined),
  );
  const available = stillTrue(
    useTelemetry("game.dlc"),
    undefined,
  )?.breakingGround;

  // Null is "could not read", never "no deployed stations".
  if (stations === null || stations.length === 0) {
    return (
      <Panel
        panelTitle="DEPLOYED SCIENCE"
        compactTitle={["DEPLOYED SCI", "DEPLOYED"]}
        sections={
          <Section>
            <EmptyState role="status">
              {emptySentence(available, stations)}
            </EmptyState>
          </Section>
        }
      />
    );
  }

  return (
    <Panel
      panelTitle="DEPLOYED SCIENCE"
      compactTitle={["DEPLOYED SCI", "DEPLOYED"]}
      /* One section per station, so a landscape tile runs the cards side by side. */
      sections={stations.map((listing) => (
        <Section key={listing.vesselId}>
          <DeployedStationCard listing={listing} />
        </Section>
      ))}
    />
  );
}

registerComponent<DeployedScienceConfig>({
  id: "deployed-science",
  name: "Deployed Science",
  description:
    "Whether each Breaking Ground deployed station's science is reaching home and when it was last heard, with its power balance and per-experiment science progress, reported even while you fly something else. Read-only.",
  tags: ["telemetry", "science"],
  defaultSize: { w: 5, h: 9 },
  // Five columns hold an experiment's figure beside its collecting badge, and seven rows keep a station's header, contact line, send and power badges and first experiment on screen with the held badge wrapped onto its own line.
  minSize: { w: 5, h: 7 },
  component: DeployedScienceComponent,
  channels: ["trackingStation.catalog", "game.dlc"],
  // The station reports are optional: with Breaking Ground absent the widget says so itself rather than giving way to the Uplink's reason.
  ...read,
  defaultConfig: {},
  actions: [],
  augmentSlots: ["deployed-science.experiment"],
  pushable: true,
  owner: BREAKING_GROUND,
});

export { DeployedScienceComponent };
