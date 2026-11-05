import { clearRegistry, getDataSource } from "@ksp-gonogo/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sitrepStreamSource } from "../dataSources/sitrep";
import { PeerClientService } from "../peer/PeerClientService";
import { registerHostSources } from "../peer/registerHostSources";
import {
  reportSitrepTransportStatus,
  resetSitrepRuntimeForTests,
} from "../telemetry/sitrepRuntime";

const client = new PeerClientService();

beforeEach(() => {
  clearRegistry();
});
afterEach(() => {
  clearRegistry();
  resetSitrepRuntimeForTests();
});

describe("the sources a station takes from its main screen's schema", () => {
  it("leaves the telemetry stream's status to the station's own link, so the offline banner can clear", async () => {
    const { registerDataSource } = await import("@ksp-gonogo/core");
    registerDataSource(sitrepStreamSource);

    registerHostSources(
      [
        { id: "sitrep", name: "Telemetry stream", keys: [] },
        { id: "missionHistory", name: "Mission history", keys: [] },
      ],
      client,
    );

    expect(getDataSource("missionHistory")).toBeDefined();
    reportSitrepTransportStatus("reconnecting");
    expect(getDataSource("sitrep")?.status).toBe("reconnecting");
    reportSitrepTransportStatus("connected");
    expect(getDataSource("sitrep")?.status).toBe("connected");
  });
});
