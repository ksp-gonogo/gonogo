import { type GameScene, getDataSource } from "@ksp-gonogo/core";
import {
  type StreamRecorder,
  useStreamRecorder,
} from "@ksp-gonogo/sitrep-client";
import {
  type FlightCurrent,
  type FlightEnded,
  type FlightStarted,
  magnitudeOf,
} from "@ksp-gonogo/sitrep-sdk";
import { useCallback, useEffect, useRef } from "react";
import { useOptionalStreamEvent } from "../hooks/useOptionalStreamEvent";
import { setAutoRecordStatus } from "./autoRecordStatus";
import { buildMissionRecord } from "./buildMissionRecord";
import type { MissionHistorySource } from "./MissionHistorySource";

function getSource(): MissionHistorySource | undefined {
  return getDataSource("missionHistory") as MissionHistorySource | undefined;
}

// `useOptionalStreamEvent` degrades to a no-op subscription: never throws:
// when no `TelemetryProvider` is mounted (`SitrepTelemetryProvider` only
// mounts a real `TelemetryProvider` once the dev streaming flag is on AND
// its `WebSocketClient` has connected; most of the time, release builds or
// the brief window before connect even in dev, there is none in the tree).

export interface AutoRecordControllerProps {
  /** Mirrors `mission.historyEnabled`: the master "record my flights" switch. Default `true`, matching the setting's own default. */
  missionHistoryEnabled?: boolean;
  /** Mirrors `mission.recordAllTopics`: forwarded to `StreamRecorder`. Default `false`. */
  recordAllTopics?: boolean;
  /**
   * Mirrors `mission.videoRecordingEnabled`. Accepted and threaded through
   * so the setting has a call site, but capturing camera streams into a
   * mission (a `MediaRecorder` tap on the kerbcast feed, a video blob
   * store, `MissionRecord.video` population) doesn't exist anywhere in this
   * codebase yet: it's a genuinely separate, large follow-up (new blob
   * storage, wiring a camera-stream tap through a package that today has no
   * camera knowledge, `ViewClock`-aligned sync). This flag is a documented
   * no-op today: telemetry auto-record is never blocked on it. Default
   * `false`.
   */
  videoRecordingEnabled?: boolean;
  /**
   * The current KSP scene, read once at the app layer (`useGameContext()`)
   * and passed down: same pattern as `missionHistoryEnabled`/
   * `recordAllTopics` (this package has no access to the app's own
   * telemetry-routing hooks). A transition AWAY from `"Flight"` finishes
   * and saves any in-progress recording: `vessel.*` topics stop ticking
   * outside the flight scene, so without this the `FlightDetector` tick
   * below would never fire again and a recording would be silently
   * orphaned (never saved) if the player just returns to the Space Center.
   * Default `"Unknown"`: no scene signal, no scene-exit finalization.
   */
  scene?: GameScene;
}

/**
 * Automatic, on-by-default flight recording for the main screen: while
 * `missionHistoryEnabled` is on, every flight is captured with no user
 * gesture. `FlightsManager`'s own doc comment covers the table side.
 *
 * **Boundary approach: mod-native, not a client heuristic:** delimits
 * recordings on the mod's own `flight.started`/`flight.ended` events. The mod
 * mints the flight id (`Vessel.id`) and does ALL boundary detection
 * server-side, revert included, so this controller is a thin, event-driven
 * mirror. A client-side guess off `vesselName` + `missionTime` + a
 * revert threshold can only approximate any of that:
 *
 * - `flight.started` closes whatever session is open and starts a fresh
 *   one for the new flight.
 * - `flight.ended` (recovered/crashed/reverted/destroyed: the reason
 *   itself isn't needed here, only "this flight is over") closes the
 *   session for that SAME flight id. Because `flight.ended` is `Delayed`
 *   (rides the light-time reveal clock, same class as `crash.lastCrash`),
 *   it arrives right after the last pre-crash frame the operator actually
 *   sees: so the recording captures the full flight up to the crash with
 *   no special-casing, and under a real signal delay the recorder closes
 *   exactly when the operator's own view of the flight ends, not when it
 *   happened in real time.
 *
 * **The mod DOES republish `flight.started`, so a re-announce is ignored
 * here.** KSP is normally already running when the browser connects, and a
 * publish for a topic nobody holds is dropped, so the host re-announces the
 * open flight to whoever subscribes later (`FlightLifecycleSampler`). On a
 * fresh page-load that is the whole reason auto-record arms mid-flight at all.
 * On a reconnect it would otherwise open a second `StreamRecorder` session for
 * a flight already being recorded, and `StreamRecorder`'s start/stop-a-whole-
 * fixture shape has no way to append into a flight it has already closed: a
 * second mission row for what the mod considers logically one flight.
 *
 * A re-announce is told from a genuinely new flight by `(flightId, ut)`, not
 * by id alone: a revert republishes `flight.started` for the SAME vessel id
 * and that one IS a new flight, distinguished only by carrying the
 * revert-target UT where a re-announce carries the original launch instant.
 */
export function AutoRecordController({
  missionHistoryEnabled = true,
  recordAllTopics = false,
  videoRecordingEnabled: _videoRecordingEnabled = false,
  scene = "Unknown",
}: AutoRecordControllerProps = {}) {
  const recorder = useStreamRecorder({ recordAllTopics });

  const activeFlightIdRef = useRef<string | null>(null);
  /** The start UT of the flight `activeFlightIdRef` holds: the other half of the re-announce key. */
  const activeFlightStartedUtRef = useRef<number | null>(null);
  const activeVesselNameRef = useRef<string>("");
  const activeLaunchedAtRef = useRef<number>(0);
  const prevSceneRef = useRef<GameScene>(scene);
  const missionHistoryEnabledRef = useRef(missionHistoryEnabled);
  missionHistoryEnabledRef.current = missionHistoryEnabled;

  /**
   * Synchronous stop (grabs whatever's buffered) + fire-and-forget async
   * save. Deliberately NOT awaited by callers before `recorder.start()`ing
   * a fresh session: `stop()` itself is synchronous, so there's no capture
   * gap between finishing one flight's recording and starting the next; only
   * the IndexedDB write trails behind.
   */
  const finishAndSave = useCallback((r: StreamRecorder): void => {
    if (!r.recording) return;
    const fixture = r.stop();
    const record = buildMissionRecord({
      vesselName: activeVesselNameRef.current,
      launchedAt: activeLaunchedAtRef.current,
      fixture,
    });
    if (record) {
      const src = getSource();
      // `getSource()` is a cast (getDataSource returns the base DataSource shape),
      // so guard the method exists, not just the source: during an abnormal
      // teardown (e.g. an unrelated error-boundary unmount) the registered
      // "missionHistory" source may momentarily not be the real
      // MissionHistorySource, and calling a missing `saveMission` would throw and
      // mask the original error. `finishAndSave` is fire-and-forget best-effort.
      if (typeof src?.saveMission === "function") void src.saveMission(record);
    }
    setAutoRecordStatus({ recording: false, vesselName: null, frameCount: 0 });
  }, []);

  // Master switch off -> stop + save whatever's in flight.
  useEffect(() => {
    if (missionHistoryEnabled || !recorder) return;
    finishAndSave(recorder);
  }, [missionHistoryEnabled, recorder, finishAndSave]);

  // Master switch flipped back ON mid-flight: resume recording the
  // already-tracked flight (flight.started only fires once per boundary,
  // so without this a toggle-off-then-on would leave the rest of the
  // flight unrecorded).
  useEffect(() => {
    if (!missionHistoryEnabled || !recorder || recorder.recording) return;
    if (!activeFlightIdRef.current) return;
    recorder.start();
    setAutoRecordStatus({
      recording: true,
      vesselName: activeVesselNameRef.current,
      frameCount: recorder.frameCount,
    });
  }, [missionHistoryEnabled, recorder]);

  // Scene-exit-to-non-flight -> stop + save. Without this a recording started
  // in flight sits open until the mod's OWN flight.ended eventually fires (a
  // later recovery, say), rather than closing the moment the operator
  // navigates away.
  useEffect(() => {
    const prev = prevSceneRef.current;
    prevSceneRef.current = scene;
    if (prev === "Flight" && scene !== "Flight" && recorder?.recording) {
      finishAndSave(recorder);
    }
  }, [scene, recorder, finishAndSave]);

  useOptionalStreamEvent<FlightStarted>(
    "flight.started",
    useCallback(
      (payload) => {
        if (!recorder) return;
        const startedUt = magnitudeOf(payload.ut);
        if (
          payload.flightId === activeFlightIdRef.current &&
          startedUt === activeFlightStartedUtRef.current
        ) {
          // The host re-announcing the flight we are already recording (see
          // this component's doc comment). Closing and reopening the session
          // here is what splits one flight across two mission rows.
          return;
        }
        finishAndSave(recorder);
        activeFlightIdRef.current = payload.flightId;
        activeFlightStartedUtRef.current = startedUt;
        activeVesselNameRef.current = payload.vesselName;
        activeLaunchedAtRef.current = Date.now();
        if (!missionHistoryEnabledRef.current) return;
        recorder.start();
        setAutoRecordStatus({
          recording: true,
          vesselName: payload.vesselName,
          frameCount: recorder.frameCount,
        });
      },
      [recorder, finishAndSave],
    ),
  );

  useOptionalStreamEvent<FlightEnded>(
    "flight.ended",
    useCallback(
      (payload) => {
        if (!recorder) return;
        if (payload.flightId !== activeFlightIdRef.current) return;
        finishAndSave(recorder);
      },
      [recorder, finishAndSave],
    ),
  );

  // Live frame-count heartbeat: flight.current ticks every sample while a
  // flight is active (the same cadence StreamRecorder's own capture rides),
  // so it's the natural per-tick pulse to refresh the UI-facing status now
  // that boundary detection itself is fully event-driven. Boundary state
  // (activeFlightIdRef etc.) is untouched here, this only re-reads
  // recorder.frameCount.
  useOptionalStreamEvent<FlightCurrent>(
    "flight.current",
    useCallback(() => {
      if (!recorder?.recording) return;
      setAutoRecordStatus({
        recording: true,
        vesselName: activeVesselNameRef.current,
        frameCount: recorder.frameCount,
      });
    }, [recorder]),
  );

  // Unmount (or recorder identity change): flush whatever's in flight
  // rather than silently dropping a partial recording (screen navigation,
  // hot reload, recordAllTopics toggled mid-flight).
  useEffect(() => {
    return () => {
      if (recorder?.recording) finishAndSave(recorder);
    };
  }, [recorder, finishAndSave]);

  return null;
}
