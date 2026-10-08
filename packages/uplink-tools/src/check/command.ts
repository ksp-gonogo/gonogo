import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { findUplinkDir } from "../cli/bake";
import { parseFlags } from "../cli/flags";
import { createIndexReader } from "./index-reader";
import {
  CheckUnableError,
  createClientProgram,
  loadTypeScript,
} from "./program";
import { GROUPS, RULES } from "./rules";
import { humanReport, jsonReport, runCheck } from "./run";
import { scanClient } from "./scan";
import { sdkDynamicPrefixes } from "./sdk-prefixes";

export const CHECK_USAGE = `uplink-tools check [options]

  Read this Uplink's client with the TypeScript compiler and report what is
  wrong with it, with the one command that heals each finding. Exits 0 when
  nothing is found, 1 when findings remain, and 2 when the check could not run.

  --client <dir>      the Uplink's client package (default: client/ in the Uplink
                      the current directory is inside)
  --fix               write the files check owns, then re-verify. Refused when
                      CI is set
  --only <groups>     run only these comma-separated groups
  --skip <groups>     leave these groups out
  --json              print the findings as JSON, and nothing else
  --max-warnings <n>  fail when there are more than n warnings

  Groups: ${GROUPS.join(", ")}`;

const list = (value: string | undefined) =>
  value === undefined ? undefined : value.split(",").filter(Boolean);

/** Returns the exit code: 0 clean, 1 findings remain, 2 the check could not run. */
export async function check(
  argv: readonly string[],
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  try {
    const { values, switches } = parseFlags(argv, {
      verb: "check",
      usage: CHECK_USAGE,
      values: ["--client", "--only", "--skip", "--max-warnings"],
      switches: ["--fix", "--json"],
    });
    const named = values.get("--client");
    const uplinkDir = findUplinkDir(cwd);
    const clientDir = resolve(
      named !== undefined
        ? resolve(cwd, named)
        : uplinkDir
          ? join(uplinkDir, "client")
          : cwd,
    );
    if (!existsSync(join(clientDir, "tsconfig.json"))) {
      throw new CheckUnableError(
        `no client with a tsconfig.json found at ${clientDir}. Run check inside an Uplink, or name its client with --client <dir>.`,
      );
    }
    const maxWarnings = values.get("--max-warnings");
    if (maxWarnings !== undefined && !/^\d+$/.test(maxWarnings)) {
      throw new CheckUnableError(
        `--max-warnings takes a number, and "${maxWarnings}" is not one`,
      );
    }
    const ts = await loadTypeScript(clientDir);
    const sdkPrefixes = sdkDynamicPrefixes(clientDir);
    const indexes = createIndexReader();
    const result = runCheck({
      rules: RULES,
      groups: GROUPS,
      clientDir,
      dynamicPrefixes: sdkPrefixes.prefixes,
      dynamicPrefixesProblem: sdkPrefixes.problem,
      scan: () =>
        scanClient(ts, createClientProgram(ts, clientDir), {
          clientDir,
          indexes,
        }),
      fix: switches.has("--fix"),
      only: list(values.get("--only")),
      skip: list(values.get("--skip")),
      maxWarnings: maxWarnings === undefined ? undefined : Number(maxWarnings),
      env,
    });
    console.log(
      switches.has("--json") ? jsonReport(result) : humanReport(result, cwd),
    );
    return result.exitCode;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
}
