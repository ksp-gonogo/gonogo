import { getUplinkHandle } from "@ksp-gonogo/core";
import type { UplinkRelay } from "@ksp-gonogo/sitrep-sdk";
import { useCallback, useEffect, useState } from "react";
import { usePeerClient } from "../peer/PeerClientContext";

/**
 * The app half of `@ksp-gonogo/sitrep-sdk`'s `useUplinkRelay`: decides how one
 * Uplink's own method call travels from wherever it was made.
 *
 * `usePeerClient()` answers null on the main screen and on any tree with no
 * provider, which is the whole branch. A station relays through the host, since
 * it never talks to anything else; anywhere else the registered handle is right
 * here and the call is a direct await with no hop.
 *
 * The two paths agree on failure as well as success. Neither ever hangs: no
 * handle registered and no live link both reject with a named `Error`, because
 * a promise that never settles is the failure mode a widget cannot render.
 *
 * The returned function changes identity when the station's link does, and that
 * is load-bearing rather than incidental. A widget mounts before its station has
 * finished connecting, so its first call lands on a null connection and is
 * rejected; without a new identity the effect that made the call would never run
 * again and the widget would stay dead for the session. Re-identifying on the
 * status edge makes the ordinary `useEffect(..., [relay])` retry once the link
 * comes up, so an Uplink gets the retry without writing one. Status changes are
 * connection edges, not traffic, so this is not a churn source.
 */
export function useUplinkRelay(uplinkId: string): UplinkRelay {
  const peerClient = usePeerClient();
  const [connStatus, setConnStatus] = useState(() =>
    peerClient ? peerClient.getConnStatus() : "idle",
  );
  useEffect(() => {
    if (!peerClient) return;
    setConnStatus(peerClient.getConnStatus());
    return peerClient.onConnectionStatus(setConnStatus);
  }, [peerClient]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: connStatus is deliberately a dependency without being read. sendUplinkRelay checks the live connection itself, so the value is not needed here; what is needed is a new identity on the connection edge, which is what makes a caller's effect retry once the link comes up.
  return useCallback(
    (method: string, args?: unknown) => {
      if (peerClient) {
        return peerClient.sendUplinkRelay(uplinkId, method, args);
      }
      const handle = getUplinkHandle<{
        relay?: (method: string, args: unknown) => Promise<unknown>;
      }>(uplinkId);
      if (typeof handle?.relay !== "function") {
        return Promise.reject(
          new Error(`"${uplinkId}" has no relay handle registered`),
        );
      }
      return handle.relay(method, args);
    },
    [peerClient, uplinkId, connStatus],
  );
}
