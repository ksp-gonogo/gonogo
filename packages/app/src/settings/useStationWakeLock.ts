import { useEffect } from "react";
import { registerSetting } from "./registry";
import { useSetting } from "./SettingsContext";

export const STATION_WAKE_LOCK_SETTING = "station.keepScreenAwake";

registerSetting({
  id: STATION_WAKE_LOCK_SETTING,
  type: "boolean",
  label: "Keep screen awake while connected",
  description:
    "Requests the browser keep this screen on while the station is connected to the main screen. Some browsers ignore the request, behaviour is best-effort.",
  category: "Station",
  defaultValue: true,
  screens: ["station"],
});

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(event: "release", cb: () => void): void;
  removeEventListener(event: "release", cb: () => void): void;
}

interface WakeLockApi {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

function getWakeLock(): WakeLockApi | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
}

/**
 * Requests a screen wake lock while `active` is true and the user has the
 * `station.keepScreenAwake` setting enabled. Re-requests on visibility
 * changes because browsers silently drop the lock when the tab backgrounds.
 */
export function useStationWakeLock(active: boolean): void {
  const [enabled] = useSetting<boolean>(STATION_WAKE_LOCK_SETTING, true);
  const want = active && enabled;

  useEffect(() => {
    if (!want) return;
    const api = getWakeLock();
    if (!api) return; // Web Wake Lock unsupported (older Safari etc.)
    const wakeLockApi: WakeLockApi = api;

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    async function acquire() {
      try {
        const next = await wakeLockApi.request("screen");
        if (cancelled) {
          void next.release();
          return;
        }
        sentinel = next;
      } catch {
        // Permission denied, page not visible, or user-agent refusal,
        // ignore; the lock is best-effort by contract.
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible" && !sentinel?.released) {
        // Request was silently dropped while backgrounded, reacquire.
        void acquire();
      }
    }

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (sentinel && !sentinel.released) void sentinel.release();
    };
  }, [want]);
}
