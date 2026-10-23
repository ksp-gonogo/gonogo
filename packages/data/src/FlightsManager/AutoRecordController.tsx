import { type GameScene, getDataSource } from "@ksp-gonogo/core";
import { logger } from "@ksp-gonogo/logger";
import {
  type ReplayFixture,
  type StreamRecorder,
  useGameStatus,
  useStreamRecorder,
} from "@ksp-gonogo/sitrep-client";
import {
  type FlightCurrent,
  type FlightEnded,
  type FlightEndReason,
  type FlightStarted,
  type FlightVesselChanged,
  magnitudeOf,
} from "@ksp-gonogo/sitrep-sdk";
import { useCallback, useEffect, useRef } from "react";
import { useOptionalStreamEvent } from "../hooks/useOptionalStreamEvent";
import type { MissionMeta } from "../storage/MissionStore";
import {
  setAutoRecordSaveFailure,
  setAutoRecordStatus,
} from "./autoRecordStatus";
import {
  buildMissionRecord,
  MISSION_PART_SECONDS,
  MISSION_PART_SIZE_LIMIT,
  withMissionPart,
} from "./buildMissionRecord";
import type { MissionHistorySource } from "./MissionHistorySource";

function getSource(): MissionHistorySource | undefined {
  return getDataSource("missionHistory") as MissionHistorySource | undefined;
}

// `useOptionalStreamEvent` degrades to a no-op subscription: never throws:
// when no `TelemetryProvider` is mounted (`SitrepTelemetryProvider` only
// mounts a real `TelemetryProvider` once the dev streaming flag is on AND
// its socket has connected; most of the time, release builds or
// the brief window before connect even in dev, there is none in the tree).

interface ParkedFlight {
  startedUt: number | null;
  vesselName: string;
  launchName: string;
  launchedAt: number;
  mission: { meta: MissionMeta; nextPart: number } | null;
}

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
   * telemetry-routing hooks). A transition away from `"Flight"` finishes
   * and saves any in-progress recording: `vessel.*` topics stop ticking
   * outside the flight scene, so without this the `FlightDetector` tick
   * below would never fire again and a recording would be silently
   * orphaned (never saved) if the player just returns to the Space Center.
   * Default `"Unknown"`: no scene signal, no scene-exit finalization.
   */
  scene?: GameScene;
  /**
   * The size at which the recording in progress is stored as a part and carried
   * on, as the length of its frames' JSON text in characters. Default
   * `MISSION_PART_SIZE_LIMIT`.
   */
  partSizeLimit?: number;
  /** The page time, in seconds, after which the recording in progress is stored as a part whatever its size. Default `MISSION_PART_SECONDS`. */
  partSeconds?: number;
}

/**
 * Automatic, on-by-default flight recording for the main screen: while
 * `missionHistoryEnabled` is on, every flight is captured with no user
 * gesture. `FlightsManager`'s own doc comment covers the table side.
 *
 * **Boundary approach: mod-native, not a client heuristic:** delimits
 * recordings on the mod's own `flight.started`/`flight.ended` events. The mod
 * mints the flight id (a revert to launch starts a new flight for the same
 * vessel, with an id of its own) and does all boundary detection
 * server-side, revert included, so this controller is a thin, event-driven
 * mirror. A client-side guess off `vesselName` + `missionTime` + a
 * revert threshold can only approximate any of that:
 *
 * - `flight.started` closes whatever session is open and starts a fresh
 *   one for the new flight.
 * - `flight.ended` (recovered/crashed/reverted/destroyed) closes the
 *   session for that same flight id and stores its reason on the mission, or
 *   on the mission already stored when the recording stopped at a scene
 *   change. A second end for a flight already closed, such as the revert
 *   after a crash, is ignored, so the first reason stands. Because `flight.ended` is `Delayed`
 *   (rides the signal delay reveal clock, same class as `crash.lastCrash`),
 *   it arrives right after the last pre-crash frame the operator actually
 *   sees: so the recording captures the full flight up to the crash with
 *   no special-casing, and under a real signal delay the recorder closes
 *   exactly when the operator's own view of the flight ends, not when it
 *   happened in real time.
 *
 * **The mod does republish `flight.started`, so a re-announce is ignored
 * here.** KSP is normally already running when the browser connects, and a
 * publish for a topic nobody holds is dropped, so the host re-announces the
 * open flight to whoever subscribes later (`FlightLifecycleSampler`). On a
 * fresh page-load that is the whole reason auto-record arms mid-flight at all.
 * On a reconnect it would otherwise open a second `StreamRecorder` session for
 * a flight already being recorded, and `StreamRecorder`'s start/stop-a-whole-
 * fixture shape has no way to append into a flight it has already closed: a
 * second mission row for what the mod considers logically one flight.
 *
 * A re-announce is told from a genuinely new flight by `(flightId, ut)`: a
 * revert starts a flight with an id of its own, at the revert-target UT, where
 * a re-announce repeats the id and the original launch instant.
 */
export function AutoRecordController({
  missionHistoryEnabled = true,
  recordAllTopics = false,
  videoRecordingEnabled: _videoRecordingEnabled = false,
  scene = "Unknown",
  partSizeLimit = MISSION_PART_SIZE_LIMIT,
  partSeconds = MISSION_PART_SECONDS,
}: AutoRecordControllerProps = {}) {
  const recorder = useStreamRecorder({ recordAllTopics });

  const activeFlightIdRef = useRef<string | null>(null);
  /** The start UT of the flight `activeFlightIdRef` holds: the other half of the re-announce key. */
  const activeFlightStartedUtRef = useRef<number | null>(null);
  const activeVesselNameRef = useRef<string>("");
  /** The name the tracked flight was announced with, kept when the vessel is renamed. */
  const launchNameRef = useRef<string>("");
  const activeLaunchedAtRef = useRef<number>(0);
  /**
   * The mission each flight was last stored as, by flight id, so an end announced
   * after its recording stopped (a scene change, or focus moving to another
   * vessel) can still be put on it. An entry goes once its flight has ended.
   */
  const savedMissionIdsRef = useRef<Map<string, string>>(new Map());
  /**
   * The flights the recording has moved away from while they are still open,
   * with what is needed to pick one up again: its announced start, its names and
   * the mission it was stored as so far. An entry goes once its flight has ended.
   */
  const parkedFlightsRef = useRef<Map<string, ParkedFlight>>(new Map());
  const prevSceneRef = useRef<GameScene>(scene);
  const missionHistoryEnabledRef = useRef(missionHistoryEnabled);
  missionHistoryEnabledRef.current = missionHistoryEnabled;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  /** The mission being recorded once its first part has been handed to the store: its meta so far, and the number of its next part. */
  const missionRef = useRef<{ meta: MissionMeta; nextPart: number } | null>(
    null,
  );
  /** The page time, in milliseconds, at which the part in hand began, or `null` while nothing is recording. */
  const partStartedAtRef = useRef<number | null>(null);
  /** The mission whose part last failed to store, so that a later part of it does not clear the report. */
  const failedMissionIdRef = useRef<string | null>(null);

  /**
   * Stores what a recorder handed back as the next part of the mission being
   * recorded, and does not wait for the write. A part that cannot be stored is
   * reported, and the parts after it are stored all the same.
   */
  const storePart = useCallback(
    (fixture: ReplayFixture, endReason?: FlightEndReason): void => {
      const recorded = missionRef.current;
      const record = buildMissionRecord({
        vesselName: activeVesselNameRef.current,
        launchName: launchNameRef.current,
        launchedAt: activeLaunchedAtRef.current,
        fixture,
        id: recorded?.meta.id,
        endReason,
      });
      if (!record) return;
      const flightId = activeFlightIdRef.current;
      if (flightId) savedMissionIdsRef.current.set(flightId, record.meta.id);
      const meta = recorded
        ? withMissionPart(recorded.meta, record.meta)
        : record.meta;
      const part = recorded?.nextPart ?? 0;
      missionRef.current = { meta, nextPart: part + 1 };
      const src = getSource();
      /*
       * `getSource()` is a cast, so the method is checked and not only the
       * source: during an abnormal teardown the registered "missionHistory"
       * source may not be the real one, and calling a missing method would throw
       * and mask the error that caused the teardown.
       */
      if (typeof src?.saveMissionPart !== "function") return;
      src.saveMissionPart(meta, part, fixture).then(
        () => {
          // A part of the same flight being stored does not undo the loss of an earlier one.
          if (failedMissionIdRef.current === meta.id) return;
          failedMissionIdRef.current = null;
          setAutoRecordSaveFailure(null);
        },
        (error: unknown) => {
          failedMissionIdRef.current = meta.id;
          setAutoRecordSaveFailure({
            vesselName: meta.vesselName,
            cause: error instanceof Error ? error.message : String(error),
          });
        },
      );
    },
    [],
  );

  /** Remembers the tracked flight so that coming back to it reopens its mission. */
  const parkTrackedFlight = useCallback((): void => {
    const flightId = activeFlightIdRef.current;
    if (!flightId) return;
    parkedFlightsRef.current.set(flightId, {
      startedUt: activeFlightStartedUtRef.current,
      vesselName: activeVesselNameRef.current,
      launchName: launchNameRef.current,
      launchedAt: activeLaunchedAtRef.current,
      mission: missionRef.current,
    });
  }, []);

  /** Tracks `flightId` again, carrying on its mission where it was left. */
  const resumeParkedFlight = useCallback((flightId: string): void => {
    const parked = parkedFlightsRef.current.get(flightId);
    parkedFlightsRef.current.delete(flightId);
    activeFlightIdRef.current = flightId;
    if (!parked) return;
    activeFlightStartedUtRef.current = parked.startedUt;
    activeVesselNameRef.current = parked.vesselName;
    launchNameRef.current = parked.launchName;
    activeLaunchedAtRef.current = parked.launchedAt;
    missionRef.current = parked.mission;
  }, []);

  /**
   * Synchronous stop (grabs whatever's buffered) + fire-and-forget async
   * save. Deliberately not awaited by callers before `recorder.start()`ing
   * a fresh session: `stop()` itself is synchronous, so there's no capture
   * gap between finishing one flight's recording and starting the next; only
   * the IndexedDB write trails behind.
   */
  const finishAndSave = useCallback(
    (r: StreamRecorder, endReason?: FlightEndReason): void => {
      if (!r.recording) return;
      storePart(r.stop(), endReason);
      if (endReason === undefined) parkTrackedFlight();
      missionRef.current = null;
      partStartedAtRef.current = null;
      setAutoRecordStatus({
        recording: false,
        vesselName: null,
        frameCount: 0,
      });
    },
    [storePart, parkTrackedFlight],
  );

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

  /*
   * The scene reading is held while the game sits at its main menu (the mod
   * samples nothing there), so it goes on saying Flight. The game status is what
   * says the menu was reached, and the next game's frames must not join this one.
   */
  const gameState = useGameStatus().state;
  useEffect(() => {
    if (gameState !== "no-game" || !recorder?.recording) return;
    finishAndSave(recorder);
  }, [gameState, recorder, finishAndSave]);

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
        launchNameRef.current = payload.vesselName;
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

  /*
   * Focus moving back onto a vessel whose flight is still open sends no second
   * flight.started, only this. The flight in hand is stored and parked, and the
   * one switched to is tracked again with its own mission reopened, so the
   * ticks that follow are recorded into it.
   */
  useOptionalStreamEvent<FlightVesselChanged>(
    "flight.vesselChanged",
    useCallback(
      (payload) => {
        if (!recorder) return;
        if (payload.flightId === activeFlightIdRef.current) return;
        finishAndSave(recorder);
        const known = parkedFlightsRef.current.has(payload.flightId);
        resumeParkedFlight(payload.flightId);
        if (!known) {
          // A flight this page never saw start: tracked from now, under the name it reports.
          activeFlightStartedUtRef.current = null;
          activeVesselNameRef.current = payload.vesselName;
          launchNameRef.current = payload.vesselName;
          activeLaunchedAtRef.current = Date.now();
          missionRef.current = null;
        }
      },
      [recorder, finishAndSave, resumeParkedFlight],
    ),
  );

  /** Puts a flight's end reason on the mission its recording was already stored as. */
  const storeReasonOnSavedMission = useCallback(
    (flightId: string, endReason: FlightEndReason): void => {
      const id = savedMissionIdsRef.current.get(flightId);
      savedMissionIdsRef.current.delete(flightId);
      const src = getSource();
      if (!id || typeof src?.setFlightEndReason !== "function") return;
      src.setFlightEndReason(id, endReason).catch((error: unknown) => {
        logger.warn("[AutoRecordController] end reason not stored", {
          err: String(error),
        });
      });
    },
    [],
  );

  useOptionalStreamEvent<FlightEnded>(
    "flight.ended",
    useCallback(
      (payload) => {
        if (!recorder) return;
        parkedFlightsRef.current.delete(payload.flightId);
        if (payload.flightId !== activeFlightIdRef.current) {
          // A flight the operator left for another vessel ends on its own.
          storeReasonOnSavedMission(payload.flightId, payload.reason);
          return;
        }
        if (recorder.recording) {
          finishAndSave(recorder, payload.reason);
          savedMissionIdsRef.current.delete(payload.flightId);
        } else {
          // The recording stopped when the scene changed, before the end was announced.
          storeReasonOnSavedMission(payload.flightId, payload.reason);
        }
        // Nothing is tracked once the flight is over, so neither the master switch nor a later tick can start recording it again.
        activeFlightIdRef.current = null;
        activeFlightStartedUtRef.current = null;
      },
      [recorder, finishAndSave, storeReasonOnSavedMission],
    ),
  );

  /*
   * flight.current ticks every sample while a flight is active, the cadence
   * StreamRecorder's own capture rides, so it refreshes the frame count the
   * status shows.
   *
   * It is also what resumes a recording that leaving the Flight scene closed.
   * The mod sends no second flight.started for a vessel the operator returns
   * to, and a tick naming the tracked flight is the proof that it is the one
   * flying again. The scene alone is not: it changes before the mod has said
   * which vessel the operator went to.
   */
  useOptionalStreamEvent<FlightCurrent>(
    "flight.current",
    useCallback(
      (payload) => {
        if (!recorder) return;
        if (
          payload.flightId === activeFlightIdRef.current &&
          payload.vesselName
        ) {
          activeVesselNameRef.current = payload.vesselName;
        }
        if (!recorder.recording) {
          if (!missionHistoryEnabledRef.current) return;
          if (payload.flightId !== activeFlightIdRef.current) return;
          if (sceneRef.current !== "Flight") return;
          resumeParkedFlight(payload.flightId);
          recorder.start();
        }
        /*
         * A recording that has grown to the size of one stored part, or has
         * run for a part's worth of page time, is stored and carried on: a long
         * flight is neither held in memory whole nor written in one piece, and
         * a tab that closes takes only the part in hand with it.
         */
        const now = performance.now();
        partStartedAtRef.current ??= now;
        if (
          recorder.bufferedSize >= partSizeLimit ||
          now - partStartedAtRef.current >= partSeconds * 1000
        ) {
          storePart(recorder.takePart());
          partStartedAtRef.current = now;
        }
        setAutoRecordStatus({
          recording: true,
          vesselName: activeVesselNameRef.current,
          frameCount:
            (missionRef.current?.meta.frameCount ?? 0) + recorder.frameCount,
        });
      },
      [recorder, partSizeLimit, partSeconds, storePart, resumeParkedFlight],
    ),
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
