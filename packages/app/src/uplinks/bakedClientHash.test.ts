/**
 * The hash a mod vouches with has to be of the bundle this build ships.
 *
 * `ExpectedClientHash.g.cs` is generated, committed, and read by the Uplink's
 * `UplinkManifest`: the running mod reports it on `system.uplinks` and the
 * loader refuses any bundle whose bytes disagree. So a committed value that has
 * fallen behind its client source is not a stale artifact, it is a refusal on
 * every load, for every operator running that mod.
 *
 * Nothing else can catch that. `codegen-check.sh` covers the generated trees it
 * knows how to regenerate with dotnet and node, and these are the only generated
 * files whose input is an esbuild bundle.
 *
 * It re-runs the bake COMMAND rather than calling the bundler in-process, which
 * buys two things: the file under `packages/app/` that the bundler lives in sits
 * outside the app's `rootDir` and cannot be imported from `src`, and the command
 * named in the failure message below is then the command this test proved works.
 *
 * Runs in `node` rather than the package's jsdom default: nothing here touches a
 * DOM, and the child process it spawns is the only thing doing real work.
 *
 * @vitest-environment node
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const generatedPath = (uplinkId: string): string =>
  join(ROOT, "mod", uplinkId, "ExpectedClientHash.g.cs");

/** `Value = "..."` out of a generated const, or undefined when the file is absent. */
function bakedHash(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  return readFileSync(path, "utf8").match(
    /public const string Value = "([^"]*)"/,
  )?.[1];
}

/**
 * Read from the same discovery CI uses rather than a list here. A list of which
 * Uplinks are armed is a list that can omit the one that broke, and this suite
 * would then pass by examining nothing.
 */
const clientBearing: { id: string }[] = JSON.parse(
  execFileSync("node", [join(ROOT, "scripts/uplink-matrix.mjs")], {
    encoding: "utf8",
  }),
).filter(
  (leg: { client: boolean; csproj: boolean }) => leg.client && leg.csproj,
);

const armed = clientBearing
  .map((leg) => leg.id)
  .filter((id) => bakedHash(generatedPath(id)));

describe("a baked ExpectedClientHash is the hash of the bundle this build ships", () => {
  it("has at least one armed Uplink to check, so a pass is never a pass over nothing", () => {
    expect(armed).not.toEqual([]);
  });

  it.each(
    armed,
  )("%s vouches for the bundle the app's build emits today", (uplinkId) => {
    const committed = generatedPath(uplinkId);
    // Baked into a COPY: a test that rewrites a tracked file leaves the tree
    // dirty when it fails, which is precisely when someone needs to read it.
    const staged = join(
      mkdtempSync(join(tmpdir(), "gonogo-baked-hash-")),
      "ExpectedClientHash.g.cs",
    );
    copyFileSync(committed, staged);
    execFileSync(
      "pnpm",
      [
        "--filter",
        "@ksp-gonogo/app",
        "bake-uplink-hash",
        uplinkId,
        "--out",
        staged,
      ],
      { cwd: ROOT, encoding: "utf8" },
    );

    expect(
      bakedHash(committed),
      `mod/${uplinkId}/ExpectedClientHash.g.cs is behind its client source. The mod would ` +
        "refuse the bundle this build serves, on every load. Rebake it:\n" +
        `  pnpm --filter @ksp-gonogo/app bake-uplink-hash ${uplinkId}`,
    ).toBe(bakedHash(staged));
  }, 120_000);
});
