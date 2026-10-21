import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DashboardConfig } from "../components/Dashboard";
import {
  type DashboardState,
  useDashboardState,
} from "../components/Dashboard/useDashboardState";
import type { MissionProfilesService } from "./MissionProfilesService";
import { type DashboardSnapshot, ProfileDashboard } from "./ProfileDashboard";

export interface ProfileDashboardHandle {
  dashboard: DashboardState;
  controller: ProfileDashboard;
}

/**
 * The dashboard state of a screen, kept in the current profile. A screen with
 * no current profile starts from `fallback` and creates one on its first
 * change. Pending changes are written when the page is hidden or closed.
 */
export function useProfileDashboard(
  service: MissionProfilesService,
  fallback: DashboardConfig,
): ProfileDashboardHandle {
  const [start] = useState<DashboardSnapshot>(() => {
    const current = service.getCurrent();
    return current
      ? { items: current.items, layout: current.layout }
      : { items: fallback.items, layout: fallback.layout };
  });
  const applyRef = useRef<(snapshot: DashboardSnapshot) => void>(() => {});
  const [controller] = useState(
    () => new ProfileDashboard(service, (s) => applyRef.current(s), start),
  );
  const dashboard = useDashboardState(start, {
    onChange: controller.recordChange,
  });
  applyRef.current = (s) => dashboard.replaceState(s.items, s.layout);

  useEffect(() => {
    const stop = controller.attach();
    const flush = () => controller.flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    globalThis.addEventListener("pagehide", flush);
    globalThis.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      globalThis.removeEventListener("pagehide", flush);
      globalThis.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [controller]);

  return { dashboard, controller };
}

/** Whether the controller has something to undo or redo, live. */
export function useHistoryState(controller: ProfileDashboard): {
  canUndo: boolean;
  canRedo: boolean;
} {
  const key = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => `${controller.canUndo()}:${controller.canRedo()}`,
  );
  return { canUndo: key.startsWith("true"), canRedo: key.endsWith("true") };
}
