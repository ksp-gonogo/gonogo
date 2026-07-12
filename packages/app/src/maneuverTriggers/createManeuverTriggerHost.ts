import type { PeerHostService } from "../peer/PeerHostService";
import {
  type ManeuverTriggerHostOptions,
  ManeuverTriggerHostService,
} from "./ManeuverTriggerHostService";

/**
 * Convenience factory mirroring `createAlarmHost`. Historically wrapped a
 * live `BufferedDataSource` lookup so the host could be constructed at
 * MainScreen-mount time even before the data source was registered — now
 * that every telemetry read/command dispatch inside `ManeuverTriggerHostService`
 * rides the stream (`getValue`/`dispatchActiveCommand`), there's nothing
 * left to wrap; kept as a thin pass-through so the MainScreen call site
 * doesn't need to change.
 */
export function createManeuverTriggerHost(
  host: PeerHostService | null,
  opts?: ManeuverTriggerHostOptions,
): ManeuverTriggerHostService {
  return new ManeuverTriggerHostService(host, opts);
}
