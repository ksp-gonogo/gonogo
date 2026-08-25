import type { HostIceServers } from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";
import { usePeerClient } from "../peer/PeerClientContext";

const NO_SERVERS: RTCIceServer[] = [];

/**
 * The app half of `@ksp-gonogo/sitrep-sdk`'s `useHostIceServers`.
 *
 * A station reads what the host has broadcast; anywhere else there is nothing to
 * read, because the main screen reaches the relay that issues the credentials
 * directly and has no need of a relayed copy.
 *
 * The returned object is stable for the lifetime of the peer client rather than
 * being rebuilt per render, so an Uplink can put it in a dependency array and
 * have the subscription survive. Credential rotation arrives through `onChange`,
 * which is why this is not a plain array: rebuilding the object on every
 * rotation would tear down the very connection the new credentials are for.
 */
export function useHostIceServers(): HostIceServers {
  const peerClient = usePeerClient();
  return useMemo(
    () => ({
      current: () => peerClient?.getRelayIceServers() ?? NO_SERVERS,
      onChange: (cb: (servers: RTCIceServer[]) => void) =>
        peerClient ? peerClient.onRelayIceServersChange(cb) : () => {},
    }),
    [peerClient],
  );
}
