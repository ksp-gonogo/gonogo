import { CatalogContact, DeployedPowerState } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  type StreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { expect } from "vitest";

/** `VesselType.DeployedScienceController`, the one vessel of a cluster that holds a CommNet link. */
const DEPLOYED_SCIENCE_CONTROLLER = 11;

export const MUN_STATION = "mun-station-controller";
export const MINMUS_STATION = "minmus-station-controller";

/** The topic one station publishes its report on. */
export const reportTopic = (stationId: string) =>
  `deployed.station.${stationId}.report`;

/** One catalog entry for a station's controller vessel, as its command centre lists it. */
export function catalogEntry(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    vesselId: MUN_STATION,
    name: "Mun Surface Base",
    vesselType: DEPLOYED_SCIENCE_CONTROLLER,
    situation: 1,
    contact: CatalogContact.InContact,
    lastContactUt: 10,
    ...over,
  };
}

/** One experiment of a station's report. */
export function experiment(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    partName: "Seismometer",
    experimentId: "deployedSeismic",
    scienceCompletedPercentage: 50,
    scienceTransmittedPercentage: 50,
    scienceValue: 30,
    scienceLimit: 60,
    storedData: 0,
    deployedOnGround: true,
    ...over,
  };
}

/** One station's report, powered and sending home, with a single experiment. */
export function stationReport(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    stationName: "Mun Surface Base",
    body: "Mun",
    situation: "LANDED",
    biome: "Highlands",
    power: DeployedPowerState.Powered,
    // A surplus with unequal sides, so a transposition would show.
    powerAvailable: 3,
    powerRequired: 2,
    sendPathHome: true,
    dataSendFailed: false,
    experiments: [experiment()],
    ...over,
  };
}

/**
 * Emits the DLC fact and the catalog, then one report per station named once its
 * topic has been subscribed. A station's topic is opened only when the catalog
 * names it, and the stub transport drops an emit nobody has subscribed to.
 */
export async function emitStations(
  fixture: StreamFixture,
  stations: Array<{
    entry?: Record<string, unknown>;
    report?: Record<string, unknown> | null;
  }> = [{}],
): Promise<void> {
  const entries = stations.map((s) => catalogEntry(s.entry));
  act(() => {
    fixture.emit("game.dlc", { breakingGround: true, makingHistory: false });
    fixture.emit("trackingStation.catalog", { entries });
  });
  for (const [i, s] of stations.entries()) {
    if (s.report === null) continue;
    const topic = reportTopic(String(entries[i]?.vesselId));
    await waitFor(() =>
      expect(fixture.transport.isSubscribed(topic)).toBe(true),
    );
    act(() => fixture.emit(topic, s.report ?? stationReport()));
  }
}
