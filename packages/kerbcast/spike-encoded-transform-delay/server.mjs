// Throwaway static file server for the spike harness pages. Serves this
// directory over plain HTTP so Worker construction and WebRTC behave
// consistently across engines (file:// has inconsistent Worker/CORS
// behaviour per-engine, especially Firefox).

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.argv[2] ?? 8934);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";
    const filePath = join(dir, pathname);
    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch (err) {
    res.writeHead(404);
    res.end(String(err));
  }
});

server.listen(port, () => {
  console.log(`spike server listening on http://localhost:${port}`);
});
