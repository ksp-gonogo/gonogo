#!/usr/bin/env node
/**
 * Writes `dist/compat.json`: the version this kit states for compatibility, as
 * a file a build tool can read without loading the kit.
 *
 * The app decides whether an Uplink's client fits by comparing the kit version
 * recorded in the client's `gonogo-uplink.json` with its own `UI_KIT_VERSION`.
 * The recorder is `uplink-tools bundle`, which runs in Node and cannot import
 * this package there, so it used to record the installed package's version. A
 * release stamps the packed manifest with the release version and leaves
 * `UI_KIT_VERSION` alone, so the two disagree in every published kit, and the
 * app would refuse every client built against one. Recording the constant
 * itself compares like with like.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "src/version.ts"), "utf8");
const match = /export const UI_KIT_VERSION\s*=\s*"([^"]+)"/.exec(source);
if (!match) {
  console.error(
    'emit-compat: no `export const UI_KIT_VERSION = "..."` in src/version.ts. The declaration moved, and this reads it by shape.',
  );
  process.exit(1);
}
writeFileSync(
  join(root, "dist/compat.json"),
  `${JSON.stringify({ uiKitVersion: match[1] }, null, 2)}\n`,
);
console.log(`compat.json: ui-kit ${match[1]}`);
