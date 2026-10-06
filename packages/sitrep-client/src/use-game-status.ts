import { useCallback, useSyncExternalStore } from "react";
import { useTelemetryStoreOptional } from "./context";
import type { GameStatus } from "./timeline-store";

const READY: GameStatus = { state: "ready", scene: "" };

/**
 * What the game is doing as the operator is shown it: ready, loading a scene
 * that has already run long enough to be worth saying, or at its main menu with
 * no game at all. Ready with no stream mounted, because nothing is then held on
 * its account.
 */
export function useGameStatus(): GameStatus {
  const store = useTelemetryStoreOptional();
  const subscribe = useCallback(
    (onChange: () => void) =>
      store ? store.subscribeGameStatus(onChange) : () => {},
    [store],
  );
  const getSnapshot = useCallback(
    () => (store ? store.gameStatus() : READY),
    [store],
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}
