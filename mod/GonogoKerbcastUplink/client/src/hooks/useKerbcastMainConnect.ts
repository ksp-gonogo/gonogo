import { useEffect } from "react";
import { kerbcastSource } from "../KerbcastDataSource";

/**
 * Main-screen-only eager connect. Historically this happened for free as
 * part of MainScreen's generic getDataSources().forEach(connect) sweep —
 * kerbcast stopped being a registered DataSource (see KerbcastDataSource.ts's
 * module doc), so it needs its own explicit trigger here. A station never
 * calls this — it drives kerbcast through StationScreen's attachBroker +
 * lazy ensureConnected() instead (see hooks/useKerbcastStream.ts,
 * hooks/useKerbcastCameras.ts).
 */
export function useKerbcastMainConnect(): void {
  useEffect(() => {
    void kerbcastSource.connect().catch(() => {
      // Settles its own status + schedules its own reconnect; swallow so a
      // failed first attempt (e.g. no sidecar reachable yet) doesn't surface
      // as an unhandled promise rejection.
    });
    return () => {
      kerbcastSource.disconnect();
    };
  }, []);
}
