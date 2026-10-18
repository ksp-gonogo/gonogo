#!/usr/bin/env node
/**
 * Does every Uplink in gonogo-uplinks still build against THIS gonogo tree?
 *
 *   node scripts/uplinks-gate.mjs <gonogo-uplinks checkout> [--only <name>] [--keep-installs]
 *
 * gonogo-uplinks builds against a vendored pin of one gonogo commit, so a slot,
 * subject or export renamed here only turns an Uplink red at the next re-pin.
 * This repins a SCRATCH checkout of it to the current commit and runs, one
 * Uplink at a time (an install of every client at once does not fit a runner or
 * a laptop): install, `page`, typecheck, the loadable, nodenext and manifest
 * legs of `uplink-tools check`, codegen against the new contract package, and
 * the client's tests. Each failure is reported under the Uplink's name with the
 * lines that name the broken id.
 *
 * The checkout is edited in place (vendor/, Directory.Build.props, every
 * client's package.json), so it must be a throwaway. The gonogo tree needs
 * `pnpm install && pnpm build` first: the sdk and ui-kit are packed from dist.
 *
 * `page` runs before the checks because a committed page records the sdk that
 * wrote it, and every Uplink's page is stale against any other sdk. That drift
 * is what a re-pin regenerates, not a break this gate is after.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "./temp-dir.mjs";

const GONOGO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const target = args.find(
  (a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--only",
);
const onlyAt = args.indexOf("--only");
const only = onlyAt >= 0 ? args[onlyAt + 1] : null;
const keepInstalls = args.includes("--keep-installs");
if (!target) {
  console.error(
    "usage: uplinks-gate.mjs <gonogo-uplinks checkout> [--only <name>] [--keep-installs]",
  );
  process.exit(2);
}
const UPLINKS = resolve(target);
const PACKAGES = [
  ["mod/sitrep-sdk", "ksp-gonogo-sitrep-sdk"],
  ["packages/ui-kit", "ksp-gonogo-ui-kit"],
  ["packages/uplink-tools", "ksp-gonogo-uplink-tools"],
];

/** Runs a command and keeps its output; the tail of a failure is what the report quotes. */
function run(cmd, cmdArgs, cwd, env = {}) {
  const started = Date.now();
  const r = spawnSync(cmd, cmdArgs, {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, CI: "true", ...env },
  });
  return {
    ok: r.status === 0,
    seconds: (Date.now() - started) / 1000,
    output: `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? String(r.error) : ""}`,
  };
}

function must(label, result) {
  if (!result.ok) {
    console.error(
      `✖ ${label} failed\n${result.output.split("\n").slice(-40).join("\n")}`,
    );
    process.exit(1);
  }
}

const sha = run("git", ["rev-parse", "HEAD"], GONOGO).output.trim();
console.log(`uplinks-gate: gonogo ${sha.slice(0, 12)} against ${UPLINKS}`);

must(
  "vendor-uplinks-reference-set",
  run(
    "bash",
    [join(GONOGO, "scripts/vendor-uplinks-reference-set.sh"), UPLINKS, sha],
    GONOGO,
  ),
);

const packed = makeTempDir("uplinks-gate-");
const vendorDir = join(UPLINKS, "vendor");
const clientManifests = readdirSync(join(UPLINKS, "uplinks"))
  .map((name) => join(UPLINKS, "uplinks", name, "client", "package.json"))
  .filter(existsSync);
for (const [dir, stem] of PACKAGES) {
  must(
    `pack ${dir}`,
    run(
      "node",
      [join(GONOGO, "scripts/pack-publishable.mjs"), join(GONOGO, dir), packed],
      GONOGO,
    ),
  );
  const tgz = readdirSync(packed).find(
    (f) => f.startsWith(`${stem}-`) && f.endsWith(".tgz"),
  );
  if (!tgz) {
    console.error(`✖ pack ${dir} produced no ${stem}-*.tgz`);
    process.exit(1);
  }
  const hash = createHash("sha256")
    .update(readFileSync(join(packed, tgz)))
    .digest("hex")
    .slice(0, 12);
  const name = `${tgz.replace(/\.tgz$/, "")}-${hash}.tgz`;
  for (const old of readdirSync(vendorDir)) {
    if (old.startsWith(`${stem}-`) && old.endsWith(".tgz"))
      rmSync(join(vendorDir, old));
  }
  copyFileSync(join(packed, tgz), join(vendorDir, name));
  for (const manifest of clientManifests) {
    const text = readFileSync(manifest, "utf8");
    writeFileSync(
      manifest,
      text.replace(
        new RegExp(`vendor/${stem}-[^"]*\\.tgz`, "g"),
        `vendor/${name}`,
      ),
    );
  }
}

const names = readdirSync(join(UPLINKS, "uplinks")).filter(
  (n) =>
    existsSync(join(UPLINKS, "uplinks", n, "uplink.json")) &&
    (!only || n === only),
);

/** The lines of a failure that name what broke: a compiler error, a manifest code, a missing export. */
function culprits(output) {
  const pattern =
    /error TS\d+|\bTS\d{4}\b|manifest\/|✖|no exported member|is not assignable|does not exist|unknown|Element type is invalid|FAIL /i;
  const lines = output.split("\n").filter((l) => pattern.test(l));
  return (lines.length ? lines : output.split("\n").slice(-8))
    .slice(0, 8)
    .map((l) => l.trim());
}

const tools = (name, ...rest) => ["tooling/uplink-tools.mjs", name, ...rest];
const results = [];
for (const name of names) {
  const client = join(UPLINKS, "uplinks", name, "client");
  const hasClient = existsSync(join(client, "package.json"));
  const hasCodegen = readdirSync(join(UPLINKS, "uplinks", name)).some((d) =>
    d.endsWith("-codegen"),
  );
  const legs = [];
  if (hasClient) {
    legs.push([
      "install",
      "npm",
      ["install", "--no-audit", "--no-fund"],
      client,
    ]);
    legs.push(["page", "node", tools(name, "page"), UPLINKS]);
    legs.push(["typecheck", "npm", ["run", "typecheck"], client]);
    legs.push([
      "loadable",
      "node",
      tools(name, "check", "--only", "loadable"),
      UPLINKS,
    ]);
    legs.push([
      "nodenext",
      "node",
      tools(name, "check", "--only", "nodenext"),
      UPLINKS,
    ]);
    legs.push([
      "manifest",
      "node",
      tools(name, "check", "--only", "manifest"),
      UPLINKS,
    ]);
  }
  if (hasCodegen)
    legs.push(["codegen", "node", tools(name, "codegen", "--check"), UPLINKS]);
  if (hasClient) legs.push(["test", "npm", ["test"], client]);

  const row = { name, legs: [], failed: [] };
  for (const [leg, cmd, cmdArgs, cwd] of legs) {
    const r = run(cmd, cmdArgs, cwd);
    row.legs.push({ leg, ok: r.ok, seconds: r.seconds });
    console.log(
      `  ${r.ok ? "ok  " : "FAIL"} ${name} ${leg} (${r.seconds.toFixed(0)}s)`,
    );
    if (!r.ok) {
      row.failed.push({ leg, culprits: culprits(r.output) });
      // A failed install leaves nothing to check against.
      if (leg === "install") break;
    }
  }
  if (hasClient && !keepInstalls)
    rmSync(join(client, "node_modules"), { recursive: true, force: true });
  results.push(row);
}

const red = results.filter((r) => r.failed.length);
const lines = [
  `### Uplinks against gonogo ${sha.slice(0, 12)}`,
  "",
  "| Uplink | Result | Seconds |",
  "|---|---|---|",
];
for (const r of results) {
  const total = r.legs.reduce((n, l) => n + l.seconds, 0).toFixed(0);
  lines.push(
    `| ${r.name} | ${r.failed.length ? `red: ${r.failed.map((f) => f.leg).join(", ")}` : "green"} | ${total} |`,
  );
}
for (const r of red) {
  for (const f of r.failed) {
    lines.push("", `**${r.name}, ${f.leg}**`, "```", ...f.culprits, "```");
    console.log(
      `::error title=Uplink ${r.name} is broken by this build (${f.leg})::${f.culprits.slice(0, 3).join(" | ")}`,
    );
  }
}
const summary = lines.join("\n");
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
process.exit(red.length ? 1 : 0);
