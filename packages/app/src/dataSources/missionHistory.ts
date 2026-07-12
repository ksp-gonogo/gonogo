import { registerDataSource } from "@ksp-gonogo/core";
import { MissionHistorySource, MissionStore } from "@ksp-gonogo/data";

/**
 * The flight-history surface (`FlightsManager`, `FlightGraph`,
 * `ChaptersEditor`, and the flight-history peer RPCs) reads off `Missions`
 * — the "press record" recordings in `MissionStore` — through this source,
 * registered under a FRESH id (`"missionHistory"`), not `"data"`.
 * `"data"`/`BufferedDataSource` are slated for wholesale deletion in a later
 * pass (P4c-b) and are untouched by this registration.
 */
export const missionHistorySource = new MissionHistorySource(
  new MissionStore(),
);

registerDataSource(missionHistorySource);
