/** Serving a built Storybook, and reading the story ids its index holds. */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

export function serve(dir: string): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
    let file = join(dir, path);
    if (existsSync(file) && statSync(file).isDirectory()) {
      file = join(file, "index.html");
    }
    if (!existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      ok({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

/** The ids of every story in a Storybook's index, refusing an index of any other shape. */
export async function storyIds(base: string): Promise<string[]> {
  const res = await fetch(`${base}/index.json`);
  const index: unknown = await res.json();
  const entries =
    typeof index === "object" && index !== null && "entries" in index
      ? index.entries
      : undefined;
  if (typeof entries !== "object" || entries === null) {
    throw new Error(`${base}/index.json holds no story entries.`);
  }
  const ids: string[] = [];
  for (const entry of Object.values(entries)) {
    if (typeof entry !== "object" || entry === null) continue;
    if (!("type" in entry) || entry.type !== "story") continue;
    if ("id" in entry && typeof entry.id === "string") ids.push(entry.id);
  }
  return ids;
}
