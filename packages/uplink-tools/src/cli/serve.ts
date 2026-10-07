/**
 * The local server behind `uplink-tools bundle --serve`: the built client, on
 * this computer only, for a development loop.
 *
 * The app loads a client whose plugin vouches for no hash only from this
 * computer, so the server listens on the loopback address and nowhere else. A
 * bundle another machine could fetch from here would be refused by the app
 * anyway.
 *
 * The app is usually open at another origin (the published one, or its own dev
 * server), so every answer allows any origin to read it, and a preflight is
 * told a public page may reach this private address. Without the second a
 * browser blocks the fetch before the first is ever read.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

/** Serve the files directly under `dir` on the loopback address. Resolves once it is listening. */
export function serveDir(dir: string, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    // The bundle is rebuilt in place, so a cached copy is the previous build.
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD");
      res.setHeader("Access-Control-Allow-Headers", "*");
      res.writeHead(204).end();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    const path = decodeURIComponent(
      new URL(req.url ?? "/", "http://localhost").pathname,
    );
    const file = normalize(join(dir, path));
    const inside = file.startsWith(normalize(dir) + sep);
    if (!inside || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found\n");
      return;
    }
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    });
    res.end(req.method === "HEAD" ? undefined : readFileSync(file));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
