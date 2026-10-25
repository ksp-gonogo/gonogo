import type { IncomingMessage } from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import type { FastifyInstance } from "fastify";
import { isAppOrigin } from "./appOrigins.js";

export interface StationsProxyOptions {
  /** Where the endpoint serves its control socket, reachable only from inside the container. */
  target: { host: string; port: number };
  extraOrigins: ReadonlySet<string>;
}

function refuse(socket: Duplex, status: string): void {
  socket.end(
    `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

/** The request line and headers exactly as the browser sent them. */
function rawHead(req: IncomingMessage): string {
  let head = `${req.method} ${req.url} HTTP/1.1\r\n`;
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    head += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
  }
  return `${head}\r\n`;
}

/**
 * Carries the main screen's WebSocket at `/stations` through to the
 * endpoint's control socket, so the main screen reaches every internet
 * station at the relay address it already uses. Only an app page may open
 * it: the socket admits stations, and any other page the main screen's
 * browser has open can reach this port too. A browser always sends `Origin`
 * on a WebSocket, so one without it is refused as well.
 */
export function registerStationsProxy(
  fastify: FastifyInstance,
  opts: StationsProxyOptions,
): void {
  fastify.server.on(
    "upgrade",
    (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = new URL(req.url ?? "/", "http://relay").pathname;
      if (path !== "/stations") {
        refuse(socket, "404 Not Found");
        return;
      }
      const origin = req.headers.origin;
      if (
        !origin ||
        !isAppOrigin(origin, opts.extraOrigins, req.headers.host)
      ) {
        refuse(socket, "403 Forbidden");
        return;
      }
      const upstream = connect(opts.target.port, opts.target.host, () => {
        upstream.write(rawHead(req));
        if (head.length > 0) upstream.write(head);
        socket.pipe(upstream).pipe(socket);
      });
      let unreachable = false;
      upstream.once("error", () => {
        unreachable = upstream.bytesRead === 0;
        if (unreachable) refuse(socket, "503 Service Unavailable");
      });
      socket.once("error", () => upstream.destroy());
      socket.once("close", () => upstream.destroy());
      upstream.once("close", () => {
        if (!unreachable) socket.destroy();
      });
    },
  );
}
