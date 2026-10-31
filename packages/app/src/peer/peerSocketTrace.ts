import { logger } from "@ksp-gonogo/logger";
import type Peer from "peerjs";

/**
 * Logs the state of a Peer's broker WebSocket (connecting, open, close code,
 * error) through the app logger, so an end-to-end trace of a host that never
 * registered shows whether its socket was held back or refused. Does nothing
 * unless the build sets `VITE_E2E_SOCKET_TRACE`, which only the Playwright dev
 * servers do.
 */
export function traceBrokerSocket(peer: Peer, label: string): void {
  if (import.meta.env.VITE_E2E_SOCKET_TRACE !== "true") return;
  /* PeerJS keeps its WebSocket on a private field of its socket wrapper. */
  const wrapper: unknown = Reflect.get(peer, "socket");
  const raw: unknown =
    typeof wrapper === "object" && wrapper !== null
      ? Reflect.get(wrapper, "_socket")
      : undefined;
  const ws = raw instanceof WebSocket ? raw : null;
  if (!ws) {
    logger.info(`[PeerSocket] ${label}: no socket to observe`);
    return;
  }
  const started = performance.now();
  const note = (event: string) =>
    logger.info(
      `[PeerSocket] ${label}: ${event} after ${Math.round(performance.now() - started)}ms, readyState=${ws.readyState}`,
    );
  note("connecting");
  ws.addEventListener("open", () => note("open"));
  ws.addEventListener("error", () => note("error"));
  ws.addEventListener("close", (e) =>
    note(`close code=${e.code} clean=${e.wasClean}`),
  );
}
