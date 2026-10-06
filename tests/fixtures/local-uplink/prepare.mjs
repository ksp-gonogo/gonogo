/**
 * Lays the fixture Uplink out in a scratch directory and builds its bundle with
 * the sdk's own CLI, which is the command an Uplink author runs.
 *
 * Copied rather than built in place because the bundle's sidecar reads the
 * installed ui-kit version from a `node_modules` above the client, and this
 * directory has none: the scratch copy gets a stub carrying the version this
 * tree's ui-kit really has, so the build is gated against the host the way a
 * real client's would be.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const target = process.argv[2];
if (!target) throw new Error("usage: prepare.mjs <scratch directory>");

const root = resolve(import.meta.dirname, "../../..");
rmSync(target, { recursive: true, force: true });
cpSync(import.meta.dirname, target, {
  recursive: true,
  filter: (source) => !source.endsWith("prepare.mjs"),
});

const uiKit = JSON.parse(
  readFileSync(join(root, "packages/ui-kit/package.json"), "utf8"),
);
const stub = join(target, "client/node_modules/@ksp-gonogo/ui-kit");
mkdirSync(stub, { recursive: true });
writeFileSync(
  join(stub, "package.json"),
  JSON.stringify({ name: "@ksp-gonogo/ui-kit", version: uiKit.version }),
);

execFileSync(
  process.execPath,
  [
    join(root, "mod/sitrep-sdk/bin/gonogo-uplink.mjs"),
    "bundle",
    "--client",
    join(target, "client"),
  ],
  { stdio: "inherit" },
);
