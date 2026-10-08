import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";

const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A temporary Uplink on disk holding `files` (paths relative to its directory), and where it is. */
export function uplinkOn(files: Readonly<Record<string, string>>): {
  uplinkDir: string;
  clientDir: string;
} {
  const uplinkDir = mkdtempSync(join(tmpdir(), "uplink-rule-"));
  scratch.push(uplinkDir);
  for (const [name, text] of Object.entries(files)) {
    const path = join(uplinkDir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return { uplinkDir, clientDir: join(uplinkDir, "client") };
}

export const UPLINK_JSON = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    id: "demo",
    name: "Demo",
    author: "Someone",
    repo: "https://github.com/someone/demo",
    csharpNamespace: "GonogoDemoUplink",
    gamedata: "GonogoDemoUplink",
    dll: "GonogoDemoUplink.dll",
    client: { url: "https://cdn.example.com/demo/0.0.1/demo.client.js" },
    ...extra,
  });

export const PACKAGE_JSON = (version = "0.0.1"): string =>
  JSON.stringify({ name: "demo-client", version });
