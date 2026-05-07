import { debugPeer, getDataSources, registerDataSource } from "@gonogo/core";
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

export function PeerHostProvider({ children }: { children: ReactNode }) {
  const [peerId, setPeerId] = useState<string | null>(peerHostService.peerId);

  // Wrapping must happen synchronously during render, before React's commit
  // phase sets up useSyncExternalStore subscriptions in child components.
  // A useState initializer runs once on mount during the render phase —
  // earlier than useEffect, which is too late.
  //
  // TODO (post-Phase-8): every source is wrapped, so `telemachus` and `data`
  // (which itself wraps `telemachus`) both broadcast every sample. Once
  // widgets all read from `data`, stop wrapping `telemachus` to halve the
  // wire traffic on the broadcast path.
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
    void peerHostService.start();
    const unsub = peerHostService.onPeerIdChange(setPeerId);
    return () => {
      unsub();
      peerHostService.stop();
    };
  }, []);

  return (
    <PeerHostContext.Provider value={{ peerId }}>
      {children}
    </PeerHostContext.Provider>
  );
}
