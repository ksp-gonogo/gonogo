import { logger } from "@ksp-gonogo/logger";
import type Peer from "peerjs";

const tracked = new Map<WebSocket, { url: string; created: number }>();

function socketTraceEnabled(): boolean {
  return import.meta.env.VITE_E2E_SOCKET_TRACE === "true";
}

function describePending(except: WebSocket): string {
  const now = performance.now();
  return [...tracked]
    .filter(([ws]) => ws !== except && ws.readyState === WebSocket.CONNECTING)
    .map(([, t]) => `${t.url} age=${Math.round(now - t.created)}ms`)
    .join(", ");
}

/**
 * Records every WebSocket the page creates (url, age while connecting, and each
 * error or close before it opened) so a broker socket held back in the
 * connecting state can be matched against the other sockets queued or refused beside it. Does
 * nothing unless the build sets `VITE_E2E_SOCKET_TRACE`. Must run before any
 * code that opens a socket.
 */
export function installSocketTrace(): void {
  if (!socketTraceEnabled() || typeof WebSocket === "undefined") return;
  const Native = WebSocket;
  window.WebSocket = new Proxy(Native, {
    construct(target, args, newTarget) {
      const ws: WebSocket = Reflect.construct(target, args, newTarget);
      const url = String(args[0]);
      const created = performance.now();
      tracked.set(ws, { url, created });
      logger.info(
        `[PeerSocket] new socket ${url}, other sockets connecting: ${describePending(ws) || "none"}`,
      );
      const since = () => `${Math.round(performance.now() - created)}ms`;
      ws.addEventListener("open", () =>
        logger.info(`[PeerSocket] socket ${url}: open after ${since()}`),
      );
      ws.addEventListener("error", () =>
        logger.info(
          `[PeerSocket] socket ${url}: error after ${since()}, readyState=${ws.readyState}`,
        ),
      );
      ws.addEventListener("close", (e) => {
        logger.info(
          `[PeerSocket] socket ${url}: close code=${e.code} after ${since()}`,
        );
        tracked.delete(ws);
      });
      return ws;
    },
  });
}

/**
 * Logs the state of a Peer's broker WebSocket (connecting, open, close code,
 * error) through the app logger, so an end-to-end trace of a host that never
 * registered shows whether its socket was held back or refused. Does nothing
 * unless the build sets `VITE_E2E_SOCKET_TRACE`, which only the Playwright dev
 * servers do.
 */
export function traceBrokerSocket(peer: Peer, label: string): void {
  if (!socketTraceEnabled()) return;
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
  logger.info(
    `[PeerSocket] ${label}: other sockets connecting: ${describePending(ws) || "none"}`,
  );
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
