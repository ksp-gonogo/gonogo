/**
 * `uplink-tools deps`: the dependency watch's command line.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findUplinkDir } from "../cli/bake";
import { parseFlags } from "../cli/flags";
import {
  BumpError,
  bumpDependencies,
  CHECK_NAMES,
  type CheckName,
  type Runner,
  resultJson,
  writeResult,
} from "./bump";
import { ckanSpelling, type Http, parseChannels } from "./channels";
import {
  asRecord,
  buildReport,
  readJsonFile,
  reportExit,
  reportJson,
  reportTable,
} from "./report";

export const DEPS_USAGE = `uplink-tools deps [--json] [options]
uplink-tools deps bump [<dependency>...] [options]
uplink-tools deps pin-ckan [options]

  deps          read every dependency this Uplink pins (the wrapped mod, the
                packages that move with it, the mods in ckanDepends that list
                channels, and gonogo's own packages) against every channel
                uplink.json lists for it, and print one row each: what is
                pinned, the newest stable release, which channel said so, and
                whether the pin is current, behind, ahead, unwatched, vendored
                or unreachable. Each channel's own answer is kept in --json, so
                one that lags shows as lagging. A prerelease is never proposed,
                and a pinned prerelease is behind its own release.
                Exits 0 when nothing is behind, 10 when something is, and 2
                when a channel could not be read: an outage never reads as
                "no changes". gonogo's own packages are reported and never
                counted as behind.
  deps bump     move the pins of the named dependencies, or of every one that
                is behind, to the newest release: uplink.json's
                mod.builtAgainst (and mod.ckanVersion, the version as CKAN
                spells it), the packages that move with the mod in
                client/package.json and its lockfile, and the min_version of a
                ckanDepends entry. Then write the page and run codegen --check,
                check, the client's typecheck and tests, dotnet build of the
                mod and dotnet test of mod-tests, and docs --check where a
                browser is installed. It touches no git.
                The result says per bump what ran against the new version, and
                its verdict is green, red, or unverified: every check passed
                and none of them touched the new bytes, as for a mod the C#
                reaches by reflection. Exits 0 green, 1 red, 3 unverified, 2
                when the bump could not be applied
  deps pin-ckan write mod.ckanVersion: the pinned version in the spelling
                CKAN lists it, with its epoch and leading v, which is what a
                relationship's min_version has to carry

  --uplink <dir>        the Uplink's directory, the one holding uplink.json
                        (default: found by walking up from the current directory)
  --json                print the report as JSON (uplink-deps/1)
  --gonogo latest|rc    the npm dist-tag gonogo's own packages are read on
                        (default latest)
  --include-prerelease  let a prerelease be the newest release
  --to <version>        bump: move the one dependency to this version
  --gamedata <dir>      bump: the GameData folder a compile-bound mod is built
                        against (default: the KspGameData environment
                        variable). The release archive is laid over a copy of
                        it for the build, and the folder itself is never written
  --reference-out <dir> bump: also copy the downloaded release of each bumped
                        mod here, as GameData folders, for a reference set that
                        is kept apart from the Uplink
  --result <file>       bump: write the uplink-bump/1 result here instead of
                        printing it
  --skip <checks>       bump: leave out these comma-separated checks:
                        ${CHECK_NAMES.join(", ")}

Reads GITHUB_TOKEN when it is set and goes unauthenticated otherwise.`;

/** The network, through the platform's fetch and the GitHub token when one is set. */
export function fetchHttp(env: NodeJS.ProcessEnv = process.env): Http {
  const headers = (url: string): Record<string, string> => {
    const base: Record<string, string> = { "User-Agent": "uplink-tools-deps" };
    if (env.GITHUB_TOKEN && url.startsWith("https://api.github.com/")) {
      base.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
    }
    return base;
  };
  const get = async (url: string): Promise<Response> => {
    const response = await fetch(url, {
      headers: headers(url),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return response;
  };
  return {
    json: async (url) => (await get(url)).json(),
    bytes: async (url) => new Uint8Array(await (await get(url)).arrayBuffer()),
  };
}

export interface DepsServices {
  http?: Http;
  run?: Runner;
  self?: readonly string[];
  env?: NodeJS.ProcessEnv;
}

/** Returns the exit code of `uplink-tools deps`. */
export async function deps(
  argv: readonly string[],
  cwd: string = process.cwd(),
  services: DepsServices = {},
): Promise<number> {
  const http = services.http ?? fetchHttp(services.env);
  const sub =
    argv[0] === "bump" || argv[0] === "pin-ckan" ? argv[0] : undefined;
  const { values, switches, positionals } = parseFlags(
    sub ? argv.slice(1) : argv,
    {
      verb: sub ? `deps ${sub}` : "deps",
      usage: DEPS_USAGE,
      values: [
        "--uplink",
        "--gonogo",
        "--to",
        "--gamedata",
        "--reference-out",
        "--result",
        "--skip",
      ],
      switches: ["--json", "--include-prerelease"],
      positionals: sub === "bump" ? 64 : 0,
    },
  );
  const named = values.get("--uplink");
  const uplinkDir = named ? resolve(cwd, named) : findUplinkDir(cwd);
  if (!uplinkDir) {
    throw new Error(
      `no uplink.json in ${cwd} or any directory above it. Run deps inside an Uplink, or name one with --uplink <dir>.`,
    );
  }
  const gonogo = values.get("--gonogo") ?? "latest";
  if (gonogo !== "latest" && gonogo !== "rc") {
    throw new Error(`--gonogo takes latest or rc, and "${gonogo}" is neither`);
  }
  const base = {
    uplinkDir,
    http,
    gonogo: gonogo as "latest" | "rc",
    includePrerelease: switches.has("--include-prerelease"),
  };

  if (sub === "pin-ckan") return pinCkan(uplinkDir, http);

  if (sub === "bump") {
    const skip = (values.get("--skip") ?? "").split(",").filter(Boolean);
    for (const name of skip) {
      if (!(CHECK_NAMES as readonly string[]).includes(name)) {
        throw new Error(
          `--skip names no check "${name}". The checks are ${CHECK_NAMES.join(", ")}`,
        );
      }
    }
    const resultFile = values.get("--result");
    const gamedata = values.get("--gamedata");
    try {
      const { result, exit } = await bumpDependencies({
        ...base,
        names: positionals,
        to: values.get("--to"),
        gamedata: gamedata ? resolve(cwd, gamedata) : undefined,
        referenceOut: values.get("--reference-out")
          ? resolve(cwd, values.get("--reference-out") as string)
          : undefined,
        skip: skip as CheckName[],
        logDir: resultFile
          ? join(resolve(cwd, resultFile, ".."), "bump-logs")
          : join(tmpdir(), `uplink-bump-${Date.now()}`),
        run: services.run,
        self: services.self,
      });
      if (resultFile) {
        writeResult(resolve(cwd, resultFile), result);
        console.log(
          result.bumps.length === 0
            ? "nothing is behind"
            : `${result.verdict}: ${result.bumps.map((b) => `${b.name} ${b.from ?? "-"} -> ${b.to}`).join(", ")}`,
        );
      } else {
        process.stdout.write(resultJson(result));
      }
      return exit;
    } catch (err) {
      if (!(err instanceof BumpError)) throw err;
      console.error(`\n${err.message}`);
      return 2;
    }
  }

  const report = await buildReport(base);
  process.stdout.write(
    switches.has("--json") ? reportJson(report) : reportTable(report),
  );
  return reportExit(report);
}

async function pinCkan(uplinkDir: string, http: Http): Promise<number> {
  const file = join(uplinkDir, "uplink.json");
  const uplink = readJsonFile(file);
  const mod = uplink.mod === null ? null : asRecord(uplink.mod);
  const ckan = parseChannels(mod?.channels, "mod.channels").channels.find(
    (c) => "ckan" in c,
  );
  const pin =
    typeof mod?.builtAgainst === "string" ? mod.builtAgainst : undefined;
  if (!mod || !ckan || !("ckan" in ckan) || !pin) {
    console.error(
      "pin-ckan needs a mod with a ckan channel and a builtAgainst version",
    );
    return 2;
  }
  const spelled = await ckanSpelling(ckan.ckan, pin, http);
  if (!spelled) {
    console.error(`CKAN lists no ${ckan.ckan} release matching ${pin}`);
    return 2;
  }
  const original = readFileSync(file, "utf8");
  mod.ckanVersion = spelled;
  const indent = /^([ \t]+)"/m.exec(original)?.[1] ?? "  ";
  writeFileSync(file, `${JSON.stringify(uplink, null, indent)}\n`);
  console.log(`${ckan.ckan}: mod.ckanVersion ${spelled}`);
  return 0;
}
