import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent } from "@ksp-gonogo/core";
import {
  useObservedVantage,
  useSelectedVantage,
} from "@ksp-gonogo/sitrep-client";
import { Meter } from "@ksp-gonogo/ui";
import { Panel, ReadoutCaption, Section } from "@ksp-gonogo/ui-kit";
import { commsRollup } from "./comms";
import { useFleet } from "./fleet";
import { RosterTable } from "./RosterTable";
import { fleetRosterTopics } from "./topics";

export type { CommsLink, FleetVessel } from "./fleet";

type FleetRosterConfig = Record<string, never>;

function FleetRosterComponent({
  w,
}: Readonly<ComponentProps<FleetRosterConfig>>) {
  const { known, vessels, coverage } = useFleet();
  const rollup = commsRollup(vessels);
  // Whose light-time the delays are computed from: the selected command centre, else the one the frames name.
  const chosenVantage = useSelectedVantage();
  const observedVantage = useObservedVantage();
  const vantage = chosenVantage ?? observedVantage;
  // Centres do not move, so a held list is still the list.
  const centresReading = fleetRosterTopics.useTelemetry("commandCentre.roster");
  const centres =
    centresReading.state === "observed" || centresReading.state === "held"
      ? centresReading.value
      : undefined;
  const vantageName =
    centres?.find((c) => c.id === vantage)?.displayName ?? vantage ?? "unknown";

  return (
    <Panel
      panelTitle="Fleet"
      panelBadges={[
        { id: "rollup", label: rollup.badgeLabel, tone: rollup.tone },
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
          <RosterTable known={known} vessels={vessels} compact={(w ?? 8) < 6} />
        </Section>,
      ]}
    />
  );
}

registerComponent<FleetRosterConfig>({
  id: "fleet-roster",
  name: "Fleet Roster",
  description:
    "Fleet-wide roster table: one row per known craft (debris, asteroids, comets, flags, EVA kerbals and deployed science hardware are left out) with name, body, crew and comms link tier (direct, relay, no link), plus a fleet-wide comms-coverage summary. Each row carries a fleet-roster.updates slot for per-vessel health or alarm lines, which Fleet Reliability fills on the active vessel's row.",
  tags: ["telemetry"],
  /* Declared, not merely rendered: the picker and search tags find extending Uplinks by walking this list. */
  augmentSlots: ["fleet-roster.updates"],
  defaultSize: { w: 8, h: 10 },
  minSize: { w: 4, h: 4 },
  component: FleetRosterComponent,
  channels: fleetRosterTopics.channels,
  /* Mission control only by declaration: nothing read is ground-only, so derivation alone would put it on a pilot's screen. */
  seats: ["mission-control"],
  defaultConfig: {},
  actions: [],
  requires: ["flight"],
});

export { FleetRosterComponent };
