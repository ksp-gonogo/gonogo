import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const scratch: string[] = [];

export const put = (dir: string, file: string, text: string) => {
  const path = join(dir, file);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};

/** An Uplink at `v` with the version written everywhere a real one writes it. */
export function fixture(v = "1.0.0-rc.4"): string {
  const dir = mkdtempSync(join(tmpdir(), "gonogo-version-"));
  scratch.push(dir);
  put(
    dir,
    "uplink.json",
    `${JSON.stringify(
      {
        id: "demo",
        client: {
          url: `https://cdn.example/gh/o/r@releases/uplinks/releases/demo/${v}/demo.client.js`,
        },
      },
      null,
      2,
    )}\n`,
  );
  put(
    dir,
    "client/package.json",
    `${JSON.stringify({ name: "demo", version: v, type: "module" }, null, 2)}\n`,
  );
  put(
    dir,
    "client/package-lock.json",
    `${JSON.stringify(
      {
        name: "demo",
        version: v,
        lockfileVersion: 3,
        packages: { "": { name: "demo", version: v } },
      },
      null,
      2,
    )}\n`,
  );
  put(
    dir,
    "client/src/uplink.ts",
    `/** Must equal package.json's version. */\nconst UPLINK_VERSION = "${v}";\nexport const DEMO = { version: UPLINK_VERSION };\n`,
  );
  writePage(join(dir, "client"));
  return dir;
}

/** What the real page writes from the client: the three outputs that quote the version. */
export function writePage(clientDir: string) {
  const v = JSON.parse(
    readFileSync(join(clientDir, "package.json"), "utf8"),
  ).version;
  put(clientDir, "gonogo-uplink.json", `{"version":"${v}"}\n`);
  put(clientDir, "docs/spec.json", `{"version":"${v}"}\n`);
  put(clientDir, "../README.md", `| Version | ${v} |\n`);
}
