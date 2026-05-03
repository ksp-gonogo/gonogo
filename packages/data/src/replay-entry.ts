/**
 * Node-safe entry point for the replay subsystem. Importing from
 * `@gonogo/data/replay` (rather than the top-level `@gonogo/data` barrel)
 * skips every React / browser-only module — the FlightsFab/FlightsManager
 * UI surface, the styled-components dependencies, the React hooks. This
 * lets non-browser consumers (the `@gonogo/replay-server` CLI, future
 * Node tooling) load the fixture + replay machinery without dragging in
 * the whole UI tree.
 */
export * from "./replay/clipFixture";
export * from "./replay/FlightFixture";
export * from "./replay/FlightReplayDataSource";
export * from "./replay/fixtureIO";
export * from "./replay/ReplayController";
export * from "./replay/synthesizeFlight";
export type {
  FlightChapterRecord,
  FlightRecord,
  Sample,
  SeriesRange,
} from "./types";
