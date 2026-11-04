import { useCallback } from "react";
import { useGoNoGoHost, useGoNoGoSnapshot } from "./GoNoGoHostContext";
import { DEFAULT_ON_GO } from "./onGo";
import { useStageCountdownFeed } from "./stageCountdownFeed";

/**
 * Hands the main screen's poll countdown to `useGoNoGoCountdown` and
 * `useLiftoffCountdown`. Mount it once, on the main screen.
 */
export function StageCountdownBridge() {
  const service = useGoNoGoHost();
  const snapshot = useGoNoGoSnapshot();
  const subscribe = useCallback(
    (listener: Parameters<NonNullable<typeof service>["onCountdown"]>[0]) =>
      service ? service.onCountdown(listener) : () => {},
    [service],
  );
  useStageCountdownFeed({
    subscribe: service ? subscribe : null,
    stagesAtGo: snapshot?.config.onGo === DEFAULT_ON_GO,
    launched: snapshot?.launched ?? false,
  });
  return null;
}
