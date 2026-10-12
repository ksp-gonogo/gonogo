import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckUnableError } from "../program";
import type { Finding } from "../types";

export const NODENEXT_GROUP = "nodenext";

const CONFIG = "tsconfig.nodenext.json";

const ERROR_LINE = /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/;

interface Compile {
  status: number | null;
  output: string;
}

/** Runs the client's own TypeScript over `config` without emitting. */
function compile(tsc: string, cwd: string, config: string): Compile {
  const run = spawnSync(
    process.execPath,
    [tsc, "--noEmit", "--pretty", "false", "-p", config],
    { cwd, encoding: "utf8" },
  );
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

function errorsOf(output: string): Array<{
  file: string;
  line: number;
  code: string;
  message: string;
}> {
  const found: Array<{
    file: string;
    line: number;
    code: string;
    message: string;
  }> = [];
  for (const line of output.split("\n")) {
    const match = ERROR_LINE.exec(line.trim());
    if (match) {
      found.push({
        file: match[1],
        line: Number(match[2]),
        code: match[3],
        message: match[4],
      });
    }
  }
  return found;
}

/**
 * Proves the compile can still tell a project that typechecks from one that
 * does not, before any result is trusted: a run that reports a type error as
 * clean would pass every client, and zero findings reads as success.
 */
function proveCompileSees(tsc: string): void {
  const dir = mkdtempSync(join(tmpdir(), "uplink-nodenext-"));
  try {
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "nodenext",
          moduleResolution: "nodenext",
          strict: true,
          noEmit: true,
        },
        files: ["bad.ts"],
      }),
    );
    writeFileSync(join(dir, "bad.ts"), 'export const n: number = "planted";\n');
    const planted = compile(tsc, dir, "tsconfig.json");
    if (planted.status === 0 || errorsOf(planted.output).length === 0) {
      throw new CheckUnableError(
        "BLIND. The compile reported a planted type error as clean, or its output could not be read, so no result for this client is trustworthy.",
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Does the client typecheck under `moduleResolution: nodenext`, the default a
 * modern Node package reaches for? The two resolutions disagree silently: a
 * `declare module` merge binds under `bundler` and not under `nodenext`, so a
 * Topic declaration vanishes and takes its keys with it, and a typecheck in
 * `bundler` mode alone cannot see it.
 */
export function checkNodenext(clientDir: string): Finding[] {
  const configFile = join(clientDir, CONFIG);
  if (!existsSync(configFile)) {
    return [
      {
        rule: "nodenext/config",
        severity: "error",
        file: configFile,
        line: 1,
        message: `${CONFIG} is missing, so the nodenext mode is not checked, and it is the mode that fails silently`,
        fixable: false,
        fix: `add ${CONFIG} extending tsconfig.json with "module": "nodenext" and "moduleResolution": "nodenext" (uplink-tools new writes one)`,
      },
    ];
  }
  const tsc = join(clientDir, "node_modules", "typescript", "bin", "tsc");
  if (!existsSync(tsc)) {
    throw new CheckUnableError(
      `typescript is not installed in ${clientDir}. Run npm install there.`,
    );
  }
  proveCompileSees(tsc);
  const result = compile(tsc, clientDir, CONFIG);
  const errors = errorsOf(result.output);
  if (result.status !== 0 && errors.length === 0) {
    throw new CheckUnableError(
      `tsc failed under ${CONFIG} without a diagnostic this check can read:\n${result.output.trim().split("\n").slice(0, 5).join("\n")}`,
    );
  }
  return errors.map((e) => ({
    rule: "nodenext/typecheck",
    severity: "error" as const,
    file: join(clientDir, e.file),
    line: e.line,
    message: `${e.code}: ${e.message}`,
    fixable: false,
    fix: `fix it so that tsc --noEmit -p ${CONFIG} is clean; a relative import needs its .js extension and a package with no exports map has no default import`,
  }));
}
