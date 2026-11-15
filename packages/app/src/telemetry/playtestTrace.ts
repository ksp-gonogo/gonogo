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
  /** Name of the vessel the active target points at, `undefined` when none. */
  targetVesselName: string | undefined;
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
  let otherName: string | undefined;

  return (s) => {
    if (s.vesselId !== undefined && s.vesselId !== vesselId) {
      vesselId = s.vesselId;
      stage = undefined;
      parts = undefined;
      link = undefined;
      docked = undefined;
      otherName = undefined;
    }
    const who = { vesselId: s.vesselId, vesselName: s.vesselName };

    if (s.currentStage !== undefined) {
      if (stage !== undefined && s.currentStage !== stage) {
        const lost =
          parts !== undefined && s.partCount !== undefined
            ? Math.max(0, parts - s.partCount)
            : undefined;
        const detail =
          s.partCount === undefined
            ? ""
            : ` (${s.partCount} parts${lost === undefined ? "" : `, ${lost} lost`})`;
        log.info(`stage changed ${stage} -> ${s.currentStage}${detail}`, {
          ...who,
          fromStage: stage,
          toStage: s.currentStage,
          partCount: s.partCount,
          partsLost: lost,
        });
        parts = s.partCount ?? parts;
      }
      stage = s.currentStage;
    }

    if (s.partCount !== undefined) {
      if (parts !== undefined && s.partCount < parts) {
        log.info(`parts lost ${parts} -> ${s.partCount}`, {
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
        const named = s.vesselName ? ` (${s.vesselName})` : "";
        log.info(
          `${s.linkConnected ? "comms link regained" : "comms link lost"}${named}`,
          {
            ...who,
            connected: s.linkConnected,
            routeHome: s.routeHome,
          },
        );
      }
      link = s.linkConnected;
    }

    const nowDocked = s.ownPortState === DockingPortState.Docked;
    if (!nowDocked || otherName === undefined) {
      otherName = s.targetVesselName ?? otherName;
    }
    if (docked !== undefined && nowDocked !== docked) {
      const other = s.targetVesselName ?? otherName;
      const label = nowDocked ? "docked with" : "undocked from";
      log.info(
        other ? `${label} ${other}` : nowDocked ? "docked" : "undocked",
        {
          ...who,
          otherVesselName: other,
          otherVesselPersistentId: s.targetVesselPersistentId,
        },
      );
    }
    docked = nowDocked;
  };
}
