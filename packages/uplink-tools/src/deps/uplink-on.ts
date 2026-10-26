import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** An Uplink on disk with the given uplink.json and, optionally, a client manifest. */
export function uplinkOn(
  uplink: Record<string, unknown>,
  client?: Record<string, unknown>,
): string {
  const dir = mkdtempSync(join(tmpdir(), "deps-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "uplink.json"),
    `${JSON.stringify(uplink, null, 2)}\n`,
  );
  if (client) {
    mkdirSync(join(dir, "client"));
    writeFileSync(
      join(dir, "client", "package.json"),
      `${JSON.stringify(client, null, 2)}\n`,
    );
  }
  return dir;
}
