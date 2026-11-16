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
import { ckanMatches, type Http, parseChannels } from "./channels";
import { patchModStrings } from "./json-edit";
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
uplink-tools deps verify-ckan [options]

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
                relationship's min_version has to carry. It refuses, naming
                the candidates, when CKAN lists none or several for the pin
  deps verify-ckan  ask CKAN whether mod.ckanVersion is exactly the spelling it
                lists for mod.builtAgainst, and fail when a CKAN-listed mod has
                none. Needs the network. Exits 0 when it is, 1 when it is not,
                and 2 when CKAN could not be read or names no single spelling

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
    argv[0] === "bump" || argv[0] === "pin-ckan" || argv[0] === "verify-ckan"
      ? argv[0]
      : undefined;
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
  if (sub === "verify-ckan") return verifyCkan(uplinkDir, http);

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

function ckanTarget(uplinkDir: string) {
  const file = join(uplinkDir, "uplink.json");
  const uplink = readJsonFile(file);
  const mod = uplink.mod === null ? null : asRecord(uplink.mod);
  const ckan = parseChannels(mod?.channels, "mod.channels").channels.find(
    (c) => "ckan" in c,
  );
  const pin =
    typeof mod?.builtAgainst === "string" ? mod.builtAgainst : undefined;
  return {
    file,
    uplink,
    mod,
    pin,
    identifier: ckan && "ckan" in ckan ? ckan.ckan : undefined,
  };
}

/** The refusal text for a pin CKAN lists no single spelling of, or undefined when it lists exactly one. */
async function spellingOrRefusal(
  identifier: string,
  pin: string,
  http: Http,
): Promise<{ spelled: string } | { refusal: string }> {
  let matches: Awaited<ReturnType<typeof ckanMatches>>;
  try {
    matches = await ckanMatches(identifier, pin, http);
  } catch (err) {
    return {
      refusal: `CKAN could not be read for ${identifier}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const { spellings, listed } = matches;
  if (spellings.length === 1) return { spelled: spellings[0] as string };
  if (spellings.length > 1) {
    return {
      refusal: `CKAN lists several ${identifier} releases matching ${pin}: ${spellings.join(", ")}. Nothing was written.`,
    };
  }
  return {
    refusal: `CKAN lists no ${identifier} release matching ${pin}. Its newest entries are ${listed.join(", ")}. Nothing was written.`,
  };
}

async function pinCkan(uplinkDir: string, http: Http): Promise<number> {
  const { file, uplink, mod, pin, identifier } = ckanTarget(uplinkDir);
  if (!mod || !identifier || !pin) {
    console.error(
      "pin-ckan needs a mod with a ckan channel and a builtAgainst version",
    );
    return 2;
  }
  const found = await spellingOrRefusal(identifier, pin, http);
  if ("refusal" in found) {
    console.error(found.refusal);
    return 2;
  }
  const original = readFileSync(file, "utf8");
  mod.ckanVersion = found.spelled;
  const indent = /^([ \t]+)"/m.exec(original)?.[1] ?? "  ";
  writeFileSync(
    file,
    patchModStrings(original, { ckanVersion: found.spelled }, uplink) ??
      `${JSON.stringify(uplink, null, indent)}\n`,
  );
  console.log(`${identifier}: mod.ckanVersion ${found.spelled}`);
  return 0;
}

async function verifyCkan(uplinkDir: string, http: Http): Promise<number> {
  const { mod, pin, identifier } = ckanTarget(uplinkDir);
  if (!mod || !identifier || !pin) {
    console.log("not a CKAN-listed mod, nothing to verify");
    return 0;
  }
  const found = await spellingOrRefusal(identifier, pin, http);
  if ("refusal" in found) {
    console.error(found.refusal);
    return 2;
  }
  const declared = typeof mod.ckanVersion === "string" ? mod.ckanVersion : "";
  if (declared === "") {
    console.error(
      `${identifier} has no mod.ckanVersion. CKAN lists ${pin} as ${found.spelled}: run \`uplink-tools deps pin-ckan\`.`,
    );
    return 1;
  }
  if (declared !== found.spelled) {
    console.error(
      `${identifier} mod.ckanVersion is ${declared} and CKAN lists ${pin} as ${found.spelled}: run \`uplink-tools deps pin-ckan\`.`,
    );
    return 1;
  }
  console.log(
    `${identifier}: mod.ckanVersion ${declared} is CKAN's spelling of ${pin}`,
  );
  return 0;
}
