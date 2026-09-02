#!/usr/bin/env node
/**
 * Removes an Uplink's copy from THIS repo, once it lives in its own.
 *
 * ## Why this is a script and not a checklist
 *
 * `clientSource` defers to a local registry descriptor, deliberately: while an
 * Uplink lives here the local copy IS the authority, and the loader has a test
 * pinning that. The moment it leaves, the same rule prefers the fossil. So the
 * departure is not a precedence change, it is actually removing the local copy,
 * and it has to be complete.
 *
 * Done by hand it is not. Removing some of the places leaves the app quarantining
 * the Uplink with `mod expects ... Hub offers ...`, which is a correct message about
 * a stale artefact and reads as a problem with the external bundle. That happened
 * on the first live run of this, which is why it is a script.
 *
 * ## Two of the three "places" are build output, which is the confusing part
 *
 * `packages/app/public/uplinks/` is entirely untracked: the Vite plugin generates
 * `registry.local.json` and every `<id>.client.js` from `UPLINK_BUNDLE_TARGETS` at
 * build time. So there is ONE tracked source of truth and two derivatives, and
 * deleting a derivative by hand achieves nothing durable while a stale `public/`
 * or `dist/` keeps answering. This removes the source and sweeps the derivatives.
 *
 * ## What it will not decide
 *
 * Plenty of references to a departed Uplink are correct and permanent: the shared
 * topic knowledge in the sdk's `default-carried-topics.ts` and `spine/map-topic.ts`,
 * the boundary allowlist's `permanent` entries, the contract's own payload types.
 * Those are shared-by-design and stay, which is what makes a blanket grep the
 * wrong tool.
 *
 * So this removes what is mechanically the Uplink's, then REPORTS every surviving
 * reference against an explicit stays-by-design list, and anything unclassified is
 * printed for a human rather than removed or ignored.
 *
 * Usage:
 *   depart-uplink.mjs <Id>            e.g. Scansat        (dry run, prints the plan)
 *   depart-uplink.mjs <Id> --apply    actually remove
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const Name = args[0];
const apply = args.includes("--apply");

if (!Name || Name.startsWith("--")) {
  console.error(
    "usage: depart-uplink.mjs <Id> [--apply]   (Id as in GonogoScansatUplink -> Scansat)",
  );
  process.exit(2);
}

const dirBase = `Gonogo${Name}Uplink`;
const id = Name.toLowerCase();
const pkg = `@ksp-gonogo/gonogo-${id}-uplink`;

/**
 * References that are CORRECT after departure, by file. Shared-by-design surface
 * an Uplink does not take with it: the app's spine knows these topic strings the
 * same way it knows any other Uplink's, and the contract owns wire types that
 * were never the Uplink's to remove.
 *
 * Listed explicitly rather than pattern-matched, so a NEW reference somewhere
 * unexpected shows up as unclassified instead of being quietly absorbed.
 */
const STAYS_BY_DESIGN = [
  "mod/sitrep-sdk/src/default-carried-topics.ts",
  "mod/sitrep-sdk/src/spine/map-topic.ts",
  "packages/core/src/uplink-boundary.allowlist.ts",
  "mod/Sitrep.Contract/",
  "mod/Sitrep.Core.Tests/",
  "mod/Sitrep.Host/",
  "mod/Sitrep.Host.IntegrationTests/",
  "mod/Gonogo.KSP/",
  "CLAUDE.md",
  "LICENSING.md",
  "THIRD-PARTY-NOTICES.md",
  "docs/",
  "scripts/depart-uplink.mjs",
];

const plan = [];
/** Things this refuses to automate, printed at the end for a human. */
const deferred = [];
const record = (what, how) => plan.push({ what, how });

// 1. the tracked source of truth for the in-repo bundle and its registry entry
const targets = join(ROOT, "packages/app/uplink-bundle-targets.ts");
const targetsSrc = readFileSync(targets, "utf8");
const entry = new RegExp(`\\n?\\s*\\{[^{}]*id:\\s*"${id}"[\\s\\S]*?\\},`, "");
if (entry.test(targetsSrc)) {
  record(`${pkg} entry in uplink-bundle-targets.ts`, () =>
    writeFileSync(targets, targetsSrc.replace(entry, "")),
  );
} else {
  console.error(
    `✖ no id: "${id}" entry found in uplink-bundle-targets.ts. That file is the ONE tracked source\n` +
      "  for the in-repo bundle and its registry entry, so if the shape has changed this script would\n" +
      "  remove the derivatives and leave the source, which is the half-removed state it exists to\n" +
      "  prevent. Refusing.",
  );
  process.exit(1);
}

// 2. the app's workspace dependency on the client package
const appPkgPath = join(ROOT, "packages/app/package.json");
const appPkg = readFileSync(appPkgPath, "utf8");
if (appPkg.includes(`"${pkg}"`)) {
  record(`${pkg} from packages/app/package.json`, () =>
    writeFileSync(
      appPkgPath,
      appPkg.replace(
        new RegExp(`\\s*"${pkg.replace("/", "\\/")}":\\s*"[^"]*",`),
        "",
      ),
    ),
  );
}

/*
 * 3. the generated derivatives. Untracked, so `git rm` would not touch them and a
 * stale copy keeps being served: this is the half that made the first hand-run
 * confusing.
 */
for (const f of [
  `packages/app/public/uplinks/${id}.client.js`,
  `packages/app/public/uplinks/${id}.client.js.sha256`,
]) {
  if (existsSync(join(ROOT, f))) {
    record(`${f} (generated)`, () => rmSync(join(ROOT, f)));
  }
}
const registry = join(ROOT, "packages/app/public/uplinks/registry.local.json");
if (existsSync(registry)) {
  const index = JSON.parse(readFileSync(registry, "utf8"));
  if (Array.isArray(index.uplinks) && index.uplinks.some((u) => u.id === id)) {
    record(`${id} from registry.local.json (generated)`, () => {
      index.uplinks = index.uplinks.filter((u) => u.id !== id);
      writeFileSync(registry, `${JSON.stringify(index, null, 2)}\n`);
    });
  }
}

/*
 * 4. the Uplink's own directories, removed through `git rm` rather than the
 * filesystem. An unstaged deletion is still listed by `git ls-files`, and several
 * gates here discover their subjects that way, so an `rm` leaves them reading a
 * tree that no longer exists and failing with ENOENT on a path nobody can find.
 */
for (const suffix of ["", ".Contract", ".Contract.Codegen", ".Tests"]) {
  const dir = join("mod", `${dirBase}${suffix}`);
  if (existsSync(join(ROOT, dir))) {
    record(`${dir}/`, () =>
      execFileSync("git", ["rm", "-r", "-q", "--", dir], { cwd: ROOT }),
    );
  }
}

/*
 * 4b. what `git rm` leaves behind: node_modules, dist, bin, obj, .turbo. All
 * untracked, so git does not touch them, and an Uplink directory that still
 * EXISTS with no csproj and no client manifest is a leg the matrix reports as
 * inert. The gate that catches it is right, and this is what it is catching.
 */
for (const suffix of ["", ".Contract", ".Contract.Codegen", ".Tests"]) {
  const dir = join(ROOT, "mod", `${dirBase}${suffix}`);
  if (existsSync(dir)) {
    record(`mod/${dirBase}${suffix}/ leftovers (untracked build output)`, () =>
      rmSync(dir, { recursive: true, force: true }),
    );
  }
}

// 5. the solution: four project stanzas plus their configuration lines
const sln = join(ROOT, "mod", "Gonogo.sln");
const slnSrc = readFileSync(sln, "utf8");
const guids = [
  ...slnSrc.matchAll(
    new RegExp(
      `Project\\("\\{[^}]+\\}"\\) = "${dirBase}[^"]*",[^\\n]*\\{([^}]+)\\}"`,
      "g",
    ),
  ),
].map((m) => m[1]);
if (guids.length > 0) {
  record(`${guids.length} ${dirBase} project(s) from Gonogo.sln`, () => {
    let out = slnSrc;
    out = out.replace(
      new RegExp(
        `Project\\("\\{[^}]+\\}"\\) = "${dirBase}[^"]*"[\\s\\S]*?EndProject\\r?\\n`,
        "g",
      ),
      "",
    );
    for (const guid of guids) {
      out = out.replace(
        new RegExp(`\\t*\\{${guid}\\}\\.[^\\n]*\\r?\\n`, "g"),
        "",
      );
    }
    writeFileSync(sln, out);
  });
}

// 6. CI: the mod job's test-project list, and the client's docs:check step
const ci = join(ROOT, ".github", "workflows", "ci.yml");
const ciSrc = readFileSync(ci, "utf8");
if (ciSrc.includes(dirBase) || ciSrc.includes(pkg)) {
  record(`${dirBase} lines from ci.yml`, () =>
    writeFileSync(
      ci,
      ciSrc
        .split("\n")
        .filter(
          (line) =>
            !new RegExp(`^\\s*${dirBase}(\\.\\w+)?\\s*$`).test(line) &&
            !line.includes(pkg),
        )
        .join("\n"),
    ),
  );
}

/*
 * 7. codegen: this Uplink's per-slice rtcli block.
 *
 * A leg ends where the NEXT leg's heading starts, and a heading is `# <Name>:`.
 * Terminating on any `\n# [A-Z]` instead ends it at the first capitalised
 * continuation line of its own comment, which left the whole leg behind under a
 * headless comment: `# SITREP_KERBCAST_TOPICMAP_OUT is set here too`. Scansat's
 * departure needed a follow-up commit for exactly that, so the terminator names
 * a heading.
 */
const codegen = join(ROOT, "mod", "codegen.sh");
const codegenSrc = readFileSync(codegen, "utf8");
const block = new RegExp(`\\n# ${Name}:[\\s\\S]*?(?=\\n# \\w+:|$)`, "i");
if (block.test(codegenSrc)) {
  record(`the ${id} block in codegen.sh`, () =>
    writeFileSync(codegen, codegenSrc.replace(block, "")),
  );
}

/*
 * 8. ratchet entries that name the departed files. These are SHRINK-ONLY lists
 * whose own tests fail on a stale entry, by design, so leaving them is not an
 * option and neither is a blanket sweep: only lines naming this Uplink's own
 * paths go.
 */
/*
 * 8. ratchet entries naming this Uplink's own files. These lists are SHRINK-ONLY
 * and their own tests fail on a stale entry, by design, so leaving them is not an
 * option.
 *
 * DISCOVERED rather than listed. A hand-kept list of which ratchets mention an
 * Uplink is the same shape as every list this project has deleted: I wrote one
 * naming two files and the suites then named four more. Anything under
 * packages/core/src holding a `mod/<Uplink>/` path is a path entry by
 * construction, and only those lines go.
 */
const ratchets = execFileSync(
  "git",
  ["grep", "-l", "--", `mod/${dirBase}/`, "packages/core/src"],
  { cwd: ROOT, encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean)
  // The stays-by-design files are prose as much as data, and this sweep is
  // line-based. Running it over one of them stripped a section heading and a
  // line from the middle of a doc comment, which is damage rather than cleanup.
  .filter((rel) => !STAYS_BY_DESIGN.some((keep) => rel.startsWith(keep)));
for (const rel of ratchets) {
  const path = join(ROOT, rel);
  const lines = readFileSync(path, "utf8").split("\n");
  /*
   * A QUOTED path only. These lists are `"path": n` or `"path",` entries, and
   * matching the bare substring also matches every comment that mentions the
   * file, so a sweep would delete the prose explaining the entry it just removed.
   */
  const isEntry = (l) =>
    new RegExp(`["'\`][^"'\`]*mod/${dirBase}/`).test(l) &&
    !l.trimStart().startsWith("*") &&
    !l.trimStart().startsWith("//");
  /*
   * Single-line entries only. An entry whose value continues on the NEXT line
   * (`"path":\n  "reason",`) cannot be removed by dropping the line that holds
   * the path: that leaves an orphaned value and the file stops parsing. This has
   * damaged three files across as many attempts, so anything that is not
   * self-contained is reported rather than guessed at.
   */
  const complete = (l) =>
    /[:,]\s*$/.test(l) &&
    /["'`].*["'`]\s*[:,]?\s*$/.test(l) &&
    !/["'`]\s*:\s*$/.test(l.trim());
  const doomed = lines.filter(isEntry).filter(complete);
  const manual = lines.filter(isEntry).filter((l) => !complete(l));
  if (manual.length > 0) {
    deferred.push(
      `${rel}: ${manual.length} entr(y/ies) span more than one line, remove by hand:\n` +
        manual.map((l) => `      ${l.trim()}`).join("\n"),
    );
  }
  if (doomed.length > 0) {
    record(`${doomed.length} ${dirBase} entr(y/ies) from ${rel}`, () =>
      writeFileSync(path, lines.filter((l) => !isEntry(l)).join("\n")),
    );
  }
}

console.log(`Departure plan for ${dirBase}:\n`);
for (const { what } of plan) console.log(`  remove  ${what}`);

if (!apply) {
  console.log(
    "\nDry run. Re-run with --apply to perform it.\n" +
      "Hand-editing instead is what this exists to prevent: removing some of these leaves the app\n" +
      "quarantining the Uplink against a stale local artefact, with a message that is correct and\n" +
      "reads as a fault in the external bundle.",
  );
  process.exit(0);
}

for (const { how } of plan) how();

/*
 * 9. the boundary allowlist is REPORTED, never edited.
 *
 * Its entries name files that mention this Uplink, and step 8 stops some of them
 * mentioning it, so its own gate then fails as STALE. Automating that prune is
 * tempting and I got it wrong twice: matching the token flagged 296 lines because
 * every OTHER mod's entries also fail "does this file mention scansat", and a
 * line sweep over the same file stripped a section heading and a line from inside
 * a doc comment, because it is prose as much as data.
 *
 * The gate already names the exact lines, legibly, and this script's own rule is
 * that it removes what is mechanically the Uplink's and decides nothing else. So
 * it points at the gate rather than pre-empting it.
 */
if (deferred.length > 0) {
  console.log(
    `\nNOT DONE, ${deferred.length} item(s) this refuses to guess at:\n` +
      deferred.map((d) => `  ${d}`).join("\n"),
  );
}

console.log(
  "\nNEXT, and this script deliberately does not do it: run the core suite. " +
    "`uplink-boundary.test.ts`\n  will fail as STALE and name the exact lines to delete from " +
    `ALLOWLIST.${id} in\n  packages/core/src/uplink-boundary.allowlist.ts. Delete those and only ` +
    "those: entries naming the\n  same file for a DIFFERENT mod are still live.",
);

/*
 * The completeness report, which is the half that matters. A removal script whose
 * own success criterion is "it ran" cannot tell a finished departure from one that
 * missed a file, and this repo has been bitten by exactly that shape repeatedly.
 */
const remaining = execFileSync("git", ["grep", "-Il", "--", id], {
  cwd: ROOT,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);
const unclassified = remaining.filter(
  (f) => !STAYS_BY_DESIGN.some((keep) => f.startsWith(keep)),
);

console.log(`\nRemoved ${plan.length} item(s).`);
console.log(
  `\n${remaining.length} tracked file(s) still mention "${id}". ` +
    `${remaining.length - unclassified.length} are shared-by-design (see STAYS_BY_DESIGN).`,
);
if (unclassified.length > 0) {
  console.log(
    "\nUNCLASSIFIED, decide each one rather than assuming it is fine:\n" +
      unclassified.map((f) => `  ${f}`).join("\n") +
      "\n\nA cross-Uplink test that enumerates Uplinks adapts on its own. One NAMING this Uplink\n" +
      "belongs in its new repo and should move rather than be deleted.",
  );
}
console.log(
  "\nNow run the suites. `public/` and `dist/` are stale until the app is rebuilt, and a stale\n" +
    "copy is exactly what makes a departed Uplink look like a broken one.",
);
