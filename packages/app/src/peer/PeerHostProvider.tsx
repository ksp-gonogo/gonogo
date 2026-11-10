import { GameWindowAudienceContext } from "@ksp-gonogo/components";
import { getDataSources, registerDataSource } from "@ksp-gonogo/core";
import { debugPeer } from "@ksp-gonogo/logger";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { hostShowsWindow } from "./gameWindowRouting";
import { PeerBroadcastingDataSource } from "./PeerBroadcastingDataSource";
import { peerHostService } from "./PeerHostService";

interface PeerHostContextValue {
  peerId: string | null;
}

const PeerHostContext = createContext<PeerHostContextValue>({ peerId: null });
export const usePeerHost = () => useContext(PeerHostContext);

/**
 * StrictMode runs an effect's cleanup and setup back to back on mount. A stop
 * there destroys the Peer while its broker WebSocket is still connecting, and
 * Firefox holds back the next WebSocket to that host, so the replacement Peer
 * registers seconds late or not at all. The stop waits one task and a setup
 * that follows straight away cancels it.
 */
let pendingStop: ReturnType<typeof setTimeout> | null = null;

/**
 * Hosts the peer mesh while mounted, under `code`, the game's join code. A
 * changed code re-claims the broker id under the new one. `generation` is the
 * mod's grant count for the role, which the host announces to stations so they
 * stay with the newest host.
 */
/** The host's own screen draws the windows its own presses opened, not those a station's did. */
const hostsOwnWindow = (pressId: string) =>
  hostShowsWindow(pressId, (id) => peerHostService.isStationWindowPress(id));

export function PeerHostProvider({
  code,
  generation,
  children,
}: {
  code: string;
  generation: number;
  children: ReactNode;
}) {
  const [peerId, setPeerId] = useState<string | null>(peerHostService.peerId);

  // Wrapping must happen synchronously during render, before React's commit
  // phase sets up useSyncExternalStore subscriptions in child components.
  // A useState initializer runs once on mount during the render phase,
  // earlier than useEffect, which is too late.
  //
  useState(() => {
    for (const source of getDataSources()) {
      if (source instanceof PeerBroadcastingDataSource) {
        debugPeer("PeerHostProvider skip wrapped", { sourceId: source.id });
        continue;
      }
      debugPeer("PeerHostProvider wrap source", {
        sourceId: source.id,
        wrappedClassName: source.constructor.name,
      });
      registerDataSource(
        new PeerBroadcastingDataSource(source, peerHostService),
      );
    }
    return null;
  });

  const [startCode] = useState(code);
  const [startGeneration] = useState(generation);
  useEffect(() => {
    if (pendingStop !== null) {
      clearTimeout(pendingStop);
      pendingStop = null;
    }
    // Not running here, so the code is taken at once and start hosts under it.
    void peerHostService.adoptShareCode(startCode);
    peerHostService.adoptGeneration(startGeneration);
    void peerHostService.start();
    const unsub = peerHostService.onPeerIdChange(setPeerId);
    return () => {
      unsub();
      pendingStop = setTimeout(() => {
        pendingStop = null;
        peerHostService.stop();
      }, 0);
    };
  }, [startCode, startGeneration]);

  useEffect(() => {
    void peerHostService.adoptShareCode(code);
  }, [code]);

  useEffect(() => {
    peerHostService.adoptGeneration(generation);
  }, [generation]);

  return (
    <PeerHostContext.Provider value={{ peerId }}>
      <GameWindowAudienceContext.Provider value={hostsOwnWindow}>
        {children}
      </GameWindowAudienceContext.Provider>
    </PeerHostContext.Provider>
  );
}
