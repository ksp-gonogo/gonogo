// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serveDir } from "./serve";

const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/** A served directory holding one bundle, with a file beside it that must stay out of reach. */
async function served() {
  const root = mkdtempSync(join(tmpdir(), "uplink-serve-"));
  const dir = join(root, "x");
  mkdirSync(dir);
  writeFileSync(join(dir, "x.client.js"), "export const x = 1;");
  writeFileSync(join(dir, "gonogo-uplink.json"), "{}");
  writeFileSync(join(root, "secret.txt"), "not served");
  const server = await serveDir(dir, 0);
  closers.push(() => {
    server.close();
    rmSync(root, { recursive: true, force: true });
  });
  const { address, port } = server.address() as AddressInfo;
  return { address, base: `http://127.0.0.1:${port}` };
}

describe("bundle --serve", () => {
  it("listens on this computer only", async () => {
    expect((await served()).address).toBe("127.0.0.1");
  });

  it("serves the bundle and its sidecar to a page at any origin, uncached", async () => {
    const { base } = await served();
    const bundle = await fetch(`${base}/x.client.js`);
    expect(bundle.status).toBe(200);
    expect(await bundle.text()).toBe("export const x = 1;");
    expect(bundle.headers.get("content-type")).toContain("text/javascript");
    expect(bundle.headers.get("access-control-allow-origin")).toBe("*");
    expect(bundle.headers.get("cache-control")).toBe("no-store");
    expect((await fetch(`${base}/gonogo-uplink.json`)).status).toBe(200);
  });

  it("tells a preflight that a public page may reach this private address", async () => {
    const { base } = await served();
    const preflight = await fetch(`${base}/x.client.js`, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-private-network")).toBe(
      "true",
    );
  });

  it.each([
    "/absent.js",
    "/../secret.txt",
    "/%2e%2e/secret.txt",
    "/",
  ])("serves nothing for %s", async (path) => {
    const { base } = await served();
    expect((await fetch(`${base}${path}`)).status).toBe(404);
  });
});
