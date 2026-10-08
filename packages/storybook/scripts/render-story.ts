/**
 * `pnpm render-story <story-id> [options]`: one story to a PNG, or a GIF when
 * it is tagged `playback`. Builds the Storybook first when no build exists,
 * then hands every argument to `uplink-tools story`, so the options and the
 * help are that command's own.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILT = resolve(PACKAGE, "dist/static");
const BIN = resolve(PACKAGE, "../uplink-tools/bin/uplink-tools.mjs");

function run(command: string, args: string[], cwd: string): number {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  return result.status ?? 1;
}

const args = process.argv.slice(2);
const asksForHelp = args.includes("--help") || args.includes("-h");
const own = (flag: string) => args.includes(flag);

if (!asksForHelp && !own("--storybook") && !existsSync(`${BUILT}/index.json`)) {
  console.log("no built Storybook yet: building it (a few minutes)");
  const built = run("pnpm", ["build-storybook"], PACKAGE);
  if (built !== 0) process.exit(built);
}

// A bare relative --out lands where the person ran the command, as it would for any CLI.
const invoked = process.env.INIT_CWD ?? process.cwd();
process.exit(
  run(
    process.execPath,
    [
      BIN,
      "story",
      ...(own("--storybook") ? [] : ["--storybook", BUILT]),
      ...args,
    ],
    invoked,
  ),
);
