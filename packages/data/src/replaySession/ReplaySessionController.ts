/**
 * The mission-replay session moved to `@ksp-gonogo/sitrep-sdk`.
 *
 * `useReplaySessionActive` is a `GonogoHost` member and an Uplink's terminal widget
 * calls it to refuse command dispatch during a replay, so an Uplink's test had to be
 * able to install the real one, and this package is `private: true`.
 *
 * It named nothing above the sdk: `ReplayTransport`, `TelemetryClient`,
 * `TimelineStore`, `ViewClock` and `PRODUCTION_DERIVED_CHANNELS` are all sdk-side,
 * `ServerMessage` and `MissionMeta` are types, and replay was already sdk territory
 * (`ReplayFixture`, the replay recorder and the stream fixture all live there).
 *
 * Re-exported so this package's importers keep their import site.
 */
export {
  getReplaySessionController,
  ReplaySessionController,
  type ReplaySessionSnapshot,
  resetReplaySessionControllerForTests,
} from "@ksp-gonogo/sitrep-sdk/spine";
