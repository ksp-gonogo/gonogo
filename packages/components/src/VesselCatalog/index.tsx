import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent } from "@ksp-gonogo/core";
import {
  useObservedVantage,
  useSelectedVantage,
} from "@ksp-gonogo/sitrep-client";
import { Meter } from "@ksp-gonogo/ui";
import {
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  Section,
} from "@ksp-gonogo/ui-kit";
import { commsRollup } from "./comms";
import { useFleet } from "./fleet";
import { RosterTable } from "./RosterTable";
import { vesselCatalogTopics } from "./topics";
import { useFleetEssentials } from "./useFleetEssentials";
import read from "./vessel-catalog.declarations.g";

export type { CommsLink, FleetVessel } from "./fleet";

type VesselCatalogConfig = Record<string, never>;

function VesselCatalogComponent({
  w,
}: Readonly<ComponentProps<VesselCatalogConfig>>) {
  const { known, reading, vessels, coverage } = useFleet();
  const rollup = commsRollup(vessels);
  // Whose light-time the delays are computed from: the selected command centre, else the one the frames name.
  const chosenVantage = useSelectedVantage();
  const observedVantage = useObservedVantage();
  const vantage = chosenVantage ?? observedVantage;
  // Centres do not move, so a held list is still the list.
  const centresReading = vesselCatalogTopics.useTelemetry(
    "commandCentre.roster",
  );
  const centres =
    centresReading.state === "observed" || centresReading.state === "held"
      ? centresReading.value
      : undefined;
  const vantageName =
    centres?.find((c) => c.id === vantage)?.displayName ?? vantage ?? "unknown";

  return (
    <Panel
      panelTitle="Vessel Catalog"
      panelBadges={[
        // Before the roster arrives there is nothing to roll up, which "No Vessels" would claim is an empty fleet.
        known
          ? {
              id: "rollup",
              label: rollup.badgeLabel,
              tone: rollup.tone,
              held: reading,
            }
          : { id: "rollup", label: NULL_DISPLAY, tone: "neutral" },
      ]}
      panelFooter={
        <Meter
          label="Comms coverage"
          value={coverage}
          tone={rollup.tone}
          valueLabel={`${rollup.linked} linked · ${rollup.none} no link${
            rollup.unknown > 0 ? ` · ${rollup.unknown} unknown` : ""
          }`}
        />
      }
      sections={[
        <Section key="vantage" full>
          <ReadoutCaption>viewing from: {vantageName}</ReadoutCaption>
        </Section>,
        /* No ScrollArea: Panel's body is the scroller. */
        <Section key="roster" full>
          <RosterTable
            known={known}
            vessels={vessels}
            compact={(w ?? 8) < 6}
            contactHeld={reading.state === "held"}
          />
        </Section>,
      ]}
    />
  );
}

registerComponent<VesselCatalogConfig>({
  id: "vessel-catalog",
  name: "Vessel Catalog",
  description:
    "Every craft you have out there, with the body it is at, its crew and its comms link (direct, relay or none), plus how much of your fleet is in contact. Debris, asteroids, comets, flags and kerbals on EVA are left out.",
  tags: ["telemetry"],
  /* Declared, not merely rendered: the picker and search tags find extending Uplinks by walking this list. */
  augmentSlots: ["vessel-catalog.updates"],
  defaultSize: { w: 8, h: 10 },
  // The roster needs five columns and six rows.
  minSize: { w: 5, h: 6 },
  component: VesselCatalogComponent,
  tiny: {
    title: "FLEET",
    useEssentials: useFleetEssentials,
  },
  channels: vesselCatalogTopics.channels,
  ...read,
  /* Mission control only by declaration: nothing read is ground-only, so derivation alone would put it on a pilot's screen. */
  seats: ["mission-control"],
  defaultConfig: {},
  actions: [],
  requires: ["flight"],
});

export { VesselCatalogComponent };
