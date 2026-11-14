import { useTelemetry } from "@ksp-gonogo/core";
import { logger } from "@ksp-gonogo/logger";
import { useEffect, useRef } from "react";
import { playtestTracer, type TraceSnapshot } from "./playtestTrace";

/**
 * Writes one `info` line, tagged `trace`, for each stage, lost part, comms
 * link change, dock and undock the host sees. Mounted on the main screen only.
 * Renders nothing.
 */
export function PlaytestTrace() {
  const identity = useTelemetry("vessel.identity");
  const structure = useTelemetry("vessel.structure");
  const link = useTelemetry("comms.link");
  const dock = useTelemetry("vessel.dock");
  const trace = useRef<ReturnType<typeof playtestTracer>>();
  trace.current ??= playtestTracer(logger.tag("trace"));

  const id = identity.state === "observed" ? identity.value : undefined;
  const st = structure.state === "observed" ? structure.value : undefined;
  const ln = link.state === "observed" ? link.value : undefined;
  const dk = dock.state === "observed" ? dock.value : undefined;

  const snapshot: TraceSnapshot = {
    vesselId: id?.vesselId,
    vesselName: id?.name,
    currentStage: st?.currentStage,
    partCount: st?.partCount?.in("count").valueOf(),
    linkConnected: ln?.connected ?? undefined,
    routeHome: ln?.routeHome ?? undefined,
    ownPortState: dk?.ownPortState ?? undefined,
    targetVesselPersistentId: dk?.targetVesselPersistentId ?? undefined,
  };
  const key = JSON.stringify(snapshot);
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the serialised snapshot
  useEffect(() => {
    trace.current?.(snapshot);
  }, [key]);
  return null;
}
