import type { BufferedDataSource } from "@ksp-gonogo/data";
import type { PeerHostService } from "../peer/PeerHostService";
import {
  type ManeuverTriggerHostOptions,
  ManeuverTriggerHostService,
} from "./ManeuverTriggerHostService";

/**
 * Convenience factory mirroring `createAlarmHost`. Wraps a live
 * BufferedDataSource lookup so the host can be constructed at
 * MainScreen-mount time even before the data source is registered.
 */
export function createManeuverTriggerHost(
  host: PeerHostService | null,
  getTelemetry: () => BufferedDataSource | null,
  opts?: ManeuverTriggerHostOptions,
): ManeuverTriggerHostService {
  return new ManeuverTriggerHostService(
    host,
    {
      getLatestValue(key) {
        return getTelemetry()?.getLatestValue(key);
      },
      execute(action) {
        const src = getTelemetry();
        if (!src) return Promise.resolve();
        return src.execute(action);
      },
      subscribe(key, cb) {
        const src = getTelemetry();
        if (!src) return () => undefined;
        return src.subscribe(key, cb);
      },
    },
    opts,
  );
}
