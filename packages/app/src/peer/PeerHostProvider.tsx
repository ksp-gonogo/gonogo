import { getDataSources, registerDataSource } from "@ksp-gonogo/core";
import { debugPeer } from "@ksp-gonogo/logger";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
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

export function PeerHostProvider({ children }: { children: ReactNode }) {
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

  useEffect(() => {
    if (pendingStop !== null) {
      clearTimeout(pendingStop);
      pendingStop = null;
    }
    void peerHostService.start();
    const unsub = peerHostService.onPeerIdChange(setPeerId);
    return () => {
      unsub();
      pendingStop = setTimeout(() => {
        pendingStop = null;
        peerHostService.stop();
      }, 0);
    };
  }, []);

  return (
    <PeerHostContext.Provider value={{ peerId }}>
      {children}
    </PeerHostContext.Provider>
  );
}
