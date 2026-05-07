import { safeRandomUuid } from "@gonogo/core";
import { debugFlight } from "./logger";
import type { FlightRecord } from "./types";

/**
 * Inferred heuristically from `v.name` + `v.missionTime`. In Phase 6 an
 * authoritative `vesselUid` will arrive from kOS; when present it takes
 * precedence and the heuristic becomes a fallback.
 */
export interface DetectorInput {
  vesselName: string;
  missionTime: number;
  /** Wall-clock at sample time. Defaults to `Date.now()` in the buffered source. */
  now: number;
  /** Phase 6: authoritative ship UID. If present, used as the flight key. */
  vesselUid?: string | null;
}

export type DetectorDecision =
  | { kind: "append"; flight: FlightRecord }
  | { kind: "new"; flight: FlightRecord }
  | { kind: "resume"; flight: FlightRecord };

/**
 * Slack window for resuming a flight when we see its vessel again. If the
 * wall-clock gap since the last sample is shorter than the mission time
 * gap + this much headroom, we treat it as a resume rather than a fresh
 * launch. 30s covers scene-change loads, short pauses, tab backgrounding.
 */
const RESUME_SLACK_MS = 30_000;

/**
 * If mission time jumps backward by more than this threshold, we call it
 * a revert → new flight. Small negative drift (physics time step
 * adjustments) shouldn't trigger; 5s is comfortably above noise.
 */
const REVERT_THRESHOLD_SEC = 5;

/**
 * Pure state machine that classifies each incoming sample into one of:
 *   - `append`: same flight as last sample, update lastMissionTime/sampleCount.
 *   - `resume`: we've seen this vessel before, pick up the existing record.
 *   - `new`: mint a fresh FlightRecord.
 *
 * Caller is responsible for persisting the returned record via the Store.
 *
 * The detector mutates its own internal map but never touches the returned
 * FlightRecord references beyond producing them — callers can safely store
 * them without defensive copies.
 */
export class FlightDetector {
  private current: FlightRecord | null = null;
  private knownByVessel = new Map<string, FlightRecord>();
  private knownByUid = new Map<string, FlightRecord>();

  /**
   * Seed the detector with previously-persisted flights. Lets us resume
   * across reloads without minting duplicate records for the same vessel.
   */
  hydrate(flights: readonly FlightRecord[]): void {
    for (const f of flights) {
      this.knownByVessel.set(f.vesselName, f);
      if (f.vesselUid) this.knownByUid.set(f.vesselUid, f);
    }
  }

  getCurrent(): FlightRecord | null {
    return this.current;
  }

  /**
   * Forget a flight — used when the user deletes one via the flights
   * manager. If it's the current flight, the next sample mints a new one.
   */
  forget(id: string): void {
    if (this.current?.id === id) this.current = null;
    for (const [name, rec] of this.knownByVessel) {
      if (rec.id === id) this.knownByVessel.delete(name);
    }
    for (const [uid, rec] of this.knownByUid) {
      if (rec.id === id) this.knownByUid.delete(uid);
    }
  }

  forgetAll(): void {
    this.current = null;
    this.knownByVessel.clear();
    this.knownByUid.clear();
  }

  /**
   * Classify a sample and return the flight record it belongs to. The
   * returned record has been mutated in place with the new
   * `lastMissionTime`, `lastSampleAt`, and incremented `sampleCount` for
   * `append`/`resume`, or freshly minted for `new`.
   */
  observe(input: DetectorInput): DetectorDecision {
    const uidMatch = input.vesselUid
      ? (this.knownByUid.get(input.vesselUid) ?? null)
      : null;

    // UID path — authoritative once we have it (Phase 6).
    if (uidMatch) {
      if (this.current?.id === uidMatch.id) {
        return this.appendTo(this.current, input);
      }
      this.current = uidMatch;
      debugFlight("resume-uid", {
        id: uidMatch.id,
        vesselUid: input.vesselUid,
      });
      return this.appendTo(uidMatch, input, "resume");
    }

    // Heuristic path — vessel name + mission time.
    if (!this.current) {
      return this.resumeOrLaunch(input);
    }

    if (this.current.vesselName === input.vesselName) {
      const revert =
        input.missionTime < this.current.lastMissionTime - REVERT_THRESHOLD_SEC;
      if (revert) {
        debugFlight("revert", {
          vesselName: input.vesselName,
          from: this.current.lastMissionTime,
          to: input.missionTime,
        });
        return this.mintNew(input);
      }
      return this.appendTo(this.current, input);
    }

    // Vessel name changed — control switched to a different ship.
    return this.resumeOrLaunch(input);
  }

  // --- Internal --------------------------------------------------------

  private resumeOrLaunch(input: DetectorInput): DetectorDecision {
    const known = this.knownByVessel.get(input.vesselName);
    if (known && this.resumable(known, input)) {
      this.current = known;
      debugFlight("resume", {
        id: known.id,
        vesselName: input.vesselName,
        wallGapMs: input.now - known.lastSampleAt,
      });
      return this.appendTo(known, input, "resume");
    }
    return this.mintNew(input);
  }

  private resumable(known: FlightRecord, input: DetectorInput): boolean {
    // Mission time must be at or after what we last saw (or within revert
    // tolerance — if it's a fresh relaunch of a same-named vessel, mission
    // time resets to ~0 and we want a new flight).
    if (input.missionTime < known.lastMissionTime - REVERT_THRESHOLD_SEC) {
      return false;
    }
    // Wall-clock gap shouldn't wildly exceed the mission-time gap. If a
    // day of wall-clock has passed with only seconds of mission time gain,
    // it's probably a fresh session on the same saved ship — treat as new.
    const missionGapMs = Math.max(
      0,
      (input.missionTime - known.lastMissionTime) * 1000,
    );
    const wallGapMs = Math.max(0, input.now - known.lastSampleAt);
    return wallGapMs <= missionGapMs + RESUME_SLACK_MS;
  }

  private mintNew(input: DetectorInput): DetectorDecision {
    const record: FlightRecord = {
      id: safeRandomUuid(),
      vesselName: input.vesselName,
      vesselUid: input.vesselUid ?? null,
      launchedAt: input.now,
      lastSampleAt: input.now,
      lastMissionTime: input.missionTime,
      sampleCount: 1,
    };
    this.current = record;
    this.knownByVessel.set(input.vesselName, record);
    if (record.vesselUid) this.knownByUid.set(record.vesselUid, record);
    debugFlight("new", {
      id: record.id,
      vesselName: input.vesselName,
      missionTime: input.missionTime,
    });
    return { kind: "new", flight: record };
  }

  private appendTo(
    record: FlightRecord,
    input: DetectorInput,
    kind: "append" | "resume" = "append",
  ): DetectorDecision {
    record.lastMissionTime = input.missionTime;
    record.lastSampleAt = input.now;
    record.sampleCount += 1;
    if (!record.vesselUid && input.vesselUid) {
      record.vesselUid = input.vesselUid;
      this.knownByUid.set(input.vesselUid, record);
    }
    return { kind, flight: record };
  }
}
