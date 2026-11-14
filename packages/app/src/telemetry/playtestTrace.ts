import type { TaggedLogger } from "@ksp-gonogo/logger";
import { DockingPortState } from "@ksp-gonogo/sitrep-sdk";

/**
 * What the main screen currently knows about the active vessel, one field per
 * Topic the trace reads. A field is `undefined` while its Topic has no
 * observed value, which is never taken as a change.
 */
export interface TraceSnapshot {
  vesselId: string | undefined;
  vesselName: string | undefined;
  currentStage: number | undefined;
  partCount: number | undefined;
  linkConnected: boolean | undefined;
  routeHome: boolean | undefined;
  /** Own docking port state, `undefined` when the dock Topic carries none. */
  ownPortState: DockingPortState | undefined;
  targetVesselPersistentId: number | undefined;
}

/**
 * Logs the playtest events that no other line records: a stage firing, parts
 * lost, the control link to the vessel dropping or returning, and a dock or
 * undock. Each line is `info`, tagged `trace`, and fires once on the change,
 * never on a repeated sample. Feed it a snapshot every time one of the Topics
 * it reads changes. A change of active vessel re-baselines silently.
 */
export function playtestTracer(
  log: TaggedLogger,
): (snapshot: TraceSnapshot) => void {
  let vesselId: string | undefined;
  let stage: number | undefined;
  let parts: number | undefined;
  let link: boolean | undefined;
  let docked: boolean | undefined;

  return (s) => {
    if (s.vesselId !== undefined && s.vesselId !== vesselId) {
      vesselId = s.vesselId;
      stage = undefined;
      parts = undefined;
      link = undefined;
      docked = undefined;
    }
    const who = { vesselId: s.vesselId, vesselName: s.vesselName };

    if (s.currentStage !== undefined) {
      if (stage !== undefined && s.currentStage !== stage) {
        log.info("stage changed", {
          ...who,
          fromStage: stage,
          toStage: s.currentStage,
          partCount: s.partCount,
          partsLost:
            parts !== undefined && s.partCount !== undefined
              ? Math.max(0, parts - s.partCount)
              : undefined,
        });
        parts = s.partCount ?? parts;
      }
      stage = s.currentStage;
    }

    if (s.partCount !== undefined) {
      if (parts !== undefined && s.partCount < parts) {
        log.info("parts lost", {
          ...who,
          stage: s.currentStage,
          fromParts: parts,
          toParts: s.partCount,
        });
      }
      parts = s.partCount;
    }

    if (s.linkConnected !== undefined) {
      if (link !== undefined && s.linkConnected !== link) {
        log.info(s.linkConnected ? "comms link regained" : "comms link lost", {
          ...who,
          connected: s.linkConnected,
          routeHome: s.routeHome,
        });
      }
      link = s.linkConnected;
    }

    const nowDocked = s.ownPortState === DockingPortState.Docked;
    if (docked !== undefined && nowDocked !== docked) {
      log.info(nowDocked ? "docked" : "undocked", {
        ...who,
        otherVesselPersistentId: s.targetVesselPersistentId,
      });
    }
    docked = nowDocked;
  };
}
