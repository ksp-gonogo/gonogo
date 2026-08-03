import { useTelemetry } from "@ksp-gonogo/core";
import { useViewUt } from "@ksp-gonogo/sitrep-client";
import { useEffect, useRef, useState } from "react";
import {
  detectContractsCompleted,
  detectDocking,
  detectEva,
  detectScienceCollected,
  detectSoiChange,
  detectStaging,
  fromCrash,
  fromFlightEnded,
  fromFlightStarted,
  fromRecovery,
  fromVesselChanged,
  type MissionEvent,
} from "./events";

/** KSP VesselType for an EVA kerbal; the SDK may expose it as the number or "EVA". */
function isEvaType(v: unknown): number {
  if (v === 7 || v === "7" || v === "EVA") return 7;
  return typeof v === "number" ? v : 0;
}

interface EdgePrev {
  stage?: number;
  body?: number;
  docked?: boolean;
  vType?: number;
  contracts?: readonly { id?: unknown; title?: unknown }[];
  science?: number;
}

/**
 * Accumulate the mission's events from the live stream into one UT-sorted list.
 *
 * Tier A (discrete topics carrying their own `ut`) are shaped straight; Tier B
 * (value topics) are edge-detected against the previous sample and stamped with
 * the current view UT (`useViewUt`). De-dup is by event `id` so a periodically
 * re-emitted discrete snapshot never doubles a row.
 *
 * v1 limitations (accepted, see events.ts): Tier-B edges can be missed between
 * samples or re-fire if the stream reconnects (prev resets); `crash.lastCrash`/
 * `recovery.lastSummary` are single "last" slots, so a mission RELOAD starts the
 * log empty rather than replaying history. A future discrete mod `*.event` topic
 * removes the Tier-B risks.
 */
export function useMissionEvents(): MissionEvent[] {
  const ut = useViewUt() ?? 0;

  // Tier A: discrete topics.
  const flightStarted = useTelemetry("flight.started");
  const flightEnded = useTelemetry("flight.ended");
  const vesselChanged = useTelemetry("flight.vesselChanged");
  const crash = useTelemetry("crash.lastCrash");
  const recovery = useTelemetry("recovery.lastSummary");

  // Tier B: value topics we edge-detect.
  const structure = useTelemetry("vessel.structure");
  const orbit = useTelemetry("vessel.orbit");
  const dock = useTelemetry("vessel.dock");
  const identity = useTelemetry("vessel.identity");
  const career = useTelemetry("career.status");

  const byId = useRef<Map<string, MissionEvent>>(new Map());
  const prev = useRef<EdgePrev>({});
  const [events, setEvents] = useState<MissionEvent[]>([]);

  // Add events by id; only re-render when the set actually grows/changes.
  function add(...next: (MissionEvent | null)[]): boolean {
    let changed = false;
    for (const e of next) {
      if (!e || byId.current.has(e.id)) continue;
      byId.current.set(e.id, e);
      changed = true;
    }
    return changed;
  }

  // Tier A: re-shape whenever any discrete snapshot changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on the topic payloads, not `add`.
  useEffect(() => {
    const changed = add(
      fromFlightStarted(flightStarted),
      fromFlightEnded(flightEnded),
      fromVesselChanged(vesselChanged),
      fromCrash(crash),
      fromRecovery(recovery),
    );
    if (changed) flush();
  }, [flightStarted, flightEnded, vesselChanged, crash, recovery]);

  // Tier B: edge-detect against the previous sample, then update prev.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the value topics; `add`/`prev` are stable refs.
  useEffect(() => {
    const p = prev.current;
    const stage =
      typeof structure?.currentStage === "number"
        ? structure.currentStage
        : undefined;
    const body =
      typeof orbit?.referenceBodyIndex === "number"
        ? orbit.referenceBodyIndex
        : undefined;
    const docked = dock != null;
    const vType = isEvaType(identity?.vesselType);
    const contracts = career?.contracts?.completedRecent;
    // `career.status.economy.science` is a branded number (Value<"science">).
    const science = career?.economy?.science;

    let changed = add(
      detectStaging(p.stage, stage, ut),
      detectSoiChange(p.body, body, ut),
      detectDocking(p.docked, docked, ut),
      detectEva(p.vType, vType, ut),
      detectScienceCollected(p.science, science, ut),
    );
    if (add(...detectContractsCompleted(p.contracts, contracts, ut))) {
      changed = true;
    }

    prev.current = { stage, body, docked, vType, contracts, science };
    if (changed) flush();
  }, [structure, orbit, dock, identity, career, ut]);

  function flush(): void {
    setEvents(
      [...byId.current.values()].sort((a, b) =>
        a.ut === b.ut ? a.id.localeCompare(b.id) : a.ut - b.ut,
      ),
    );
  }

  return events;
}
