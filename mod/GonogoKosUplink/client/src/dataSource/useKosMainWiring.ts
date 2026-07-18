import { useEffect } from "react";
import type { CpuRegistryService } from "../shared/CpuRegistryService";
import { kosSource } from "./kos";

/**
 * Auto-populates the kOS CPU registry from the mod's native kos.processors
 * push channel. Historically hand-inlined in MainScreen.tsx alongside a
 * direct KosDataSource import/instanceof check — extracted here so the
 * screen doesn't need kOS-specific logic beyond one hook call. Stations
 * don't call this — they don't dispatch to kOS directly (see
 * SitrepPeerRelay.tsx's own kos.processors mirror for the station path).
 */
export function useKosMainWiring(cpuRegistry: CpuRegistryService): void {
  useEffect(() => {
    // kosSource is always the registered "kos" DataSource in-process (this
    // hook only runs on the main screen), so the instanceof check that used
    // to guard a generic getDataSource("kos") lookup isn't needed here —
    // this hook imports the concrete instance directly.
    return kosSource.onProcessorsChanged((procs) => {
      cpuRegistry.reportOnline(
        procs.map((p) => p.tag).filter((tag): tag is string => Boolean(tag)),
      );
    });
  }, [cpuRegistry]);
}
