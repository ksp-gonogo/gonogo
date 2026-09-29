import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import type { PeerClientService } from "./PeerClientService";

/**
 * The part of the station's peer link that widgets and station chrome reach
 * through `usePeerClient()`. `PeerClientService` is the live one; a story or a
 * test supplies any object carrying these members.
 */
export type PeerClient = Pick<
  PeerClientService,
  | "getConnStatus"
  | "onConnectionStatus"
  | "onHostHello"
  | "onHostRestart"
  | "getHostCommandCentre"
  | "onHostCommandCentreChange"
  | "getRelayIceServers"
  | "onRelayIceServersChange"
  | "sendGonogoVote"
  | "sendGonogoAbort"
  | "onGonogoCountdownStart"
  | "onGonogoCountdownCancel"
  | "onGonogoAbortNotify"
  | "sendWidgetPush"
  | "sendWidgetRecall"
  | "onNotesSnapshot"
  | "sendNoteAdd"
  | "sendNoteUpdate"
  | "sendNoteDelete"
  | "sendNoteReorder"
  | "sendUplinkRelay"
  | "sendBundleFetch"
>;

const PeerClientContext = createContext<PeerClient | null>(null);

export function PeerClientProvider({
  client,
  children,
}: {
  client: PeerClient;
  children: ReactNode;
}) {
  return (
    <PeerClientContext.Provider value={client}>
      {children}
    </PeerClientContext.Provider>
  );
}

/**
 * Access the station's peer client. Returns null on the main screen (or
 * any tree without a provider), so components can branch on "am I a station
 * with peer access?" without crashing.
 */
export function usePeerClient(): PeerClient | null {
  return useContext(PeerClientContext);
}
