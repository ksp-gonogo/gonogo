#!/usr/bin/env node
// Typechecks every ts/tsx code block in docs/creating-an-uplink.md against the
// two PUBLISHED packages an Uplink author may import.
//
// The guide once taught `useTelemetry("t").coreTemp`, which is a type error on
// all six arms of the `Reading` union it actually answers with, and nothing
// noticed for 860 lines. Every ts/tsx block here is therefore a COMPLETE
// module: imports included, standing on its own. A block that cannot be one
// belongs in a `text` fence, not a `ts` fence.
//
//   node docs/examples/typecheck-guide-examples.mjs [--keep]
//
// Requires `pnpm install` and a built ui-kit (`pnpm turbo build --filter=@ksp-gonogo/ui-kit`),
// because ui-kit resolves its types out of dist.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const guide = join(repo, "docs/creating-an-uplink.md");
const work = join(repo, "node_modules/.cache/guide-examples");
const nodeTypes = "node_modules/.pnpm/@types+node@22.19.17/node_modules/@types";

/** Every fenced block, with its language and 1-based opening-fence line. */
function blocks(markdown) {
  const found = [];
  const lines = markdown.split("\n");
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const fence = /^```(\S*)\s*$/.exec(lines[i]);
    if (fence && open === null) {
      open = { lang: fence[1], line: i + 1, body: [] };
    } else if (fence && open !== null) {
      found.push(open);
      open = null;
    } else if (open !== null) {
      open.body.push(lines[i]);
    }
  }
  return found;
}

const md = readFileSync(guide, "utf8");
const checkable = blocks(md).filter((b) => b.lang === "ts" || b.lang === "tsx");
if (checkable.length === 0) {
  console.error(
    "no ts/tsx blocks found: the extractor is broken, not the guide",
  );
  process.exit(1);
}

// A `text` fence is the escape hatch for a block that genuinely cannot compile
// (a type mirror, an XML project file, code that would live in the SDK). It is
// also the obvious way to dodge this check, so a `text` block that imports the
// published packages is treated as a mislabelled `ts` one.
const dodged = blocks(md).filter(
  (b) => b.lang === "text" && b.body.some((l) => /from "@ksp-gonogo\//.test(l)),
);
if (dodged.length > 0) {
  console.error(
    `text fence(s) importing the published packages, so they belong in a ts fence:\n${dodged
      .map((b) => `  creating-an-uplink.md:${b.line}`)
      .join("\n")}`,
  );
  process.exit(1);
}

rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, "src"), { recursive: true });

// One tsconfig, resolving through a real Uplink client's node_modules so the
// blocks are checked against exactly what an installed client sees.
const modules = join(repo, "mod/GonogoAvionicsUplink/client/node_modules");
if (!existsSync(modules)) {
  console.error(`missing ${modules}: run pnpm install first`);
  process.exit(1);
}
if (!existsSync(join(repo, "packages/ui-kit/dist/index.d.ts"))) {
  console.error(
    "missing packages/ui-kit/dist: run pnpm turbo build --filter=@ksp-gonogo/ui-kit",
  );
  process.exit(1);
}
writeFileSync(
  join(work, "tsconfig.json"),
  `${JSON.stringify(
    {
      extends: join(repo, "mod/sitrep-sdk/tsconfig.base.json"),
      compilerOptions: {
        noEmit: true,
        rootDir: "./src",
        skipLibCheck: true,
        typeRoots: [join(repo, nodeTypes), join(modules, "@types")],
        types: ["node", "react"],
      },
      include: ["src"],
    },
    null,
    2,
  )}\n`,
);
execFileSync("ln", ["-sfn", modules, join(work, "node_modules")]);

// The guide labels each block that IS a file with its path on the first line
// (`// client/src/uplink.ts`). Extract those to that path, so an example's
// relative imports resolve and the whole set compiles as one client would.
const FILE_LABEL = /^\/\/\s*(client\/src\/[\w./-]+\.tsx?)\s*$/;

for (const f of ["contract.ts", "units.ts"]) {
  mkdirSync(join(work, "src/__generated__"), { recursive: true });
  writeFileSync(
    join(work, "src/__generated__", f),
    readFileSync(join(here, "generated-fixture", f), "utf8"),
  );
}

const written = [];
for (const b of checkable) {
  const label = FILE_LABEL.exec(b.body[0] ?? "");
  const rel = label
    ? label[1].replace(/^client\/src\//, "")
    : `block-L${String(b.line).padStart(4, "0")}.${b.lang}`;
  const target = join(work, "src", rel);
  mkdirSync(dirname(target), { recursive: true });
  const existing = written.find((w) => w.rel === rel);
  if (existing) {
    console.error(
      `two blocks claim ${rel}: creating-an-uplink.md:${existing.line} and :${b.line}`,
    );
    process.exit(1);
  }
  written.push({ rel, line: b.line });
  writeFileSync(target, `${b.body.join("\n")}\n`);
}

/** Map a tsc diagnostic path back to the markdown line that produced it. */
function guideLineFor(diagPath) {
  const hit = written.find((w) => w.rel === diagPath.replace(/^src\//, ""));
  return hit ? hit.line : null;
}

let out = "";
let failed = false;
try {
  out = execFileSync(
    join(repo, "node_modules/.bin/tsc"),
    ["-p", "tsconfig.json"],
    {
      cwd: work,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
} catch (err) {
  failed = true;
  out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
}

// A diagnostic inside sitrep-sdk's own sources is not this guide's problem.
const mine = [];
for (const line of out.split("\n")) {
  const at = /^(src\/[^(]+)\((\d+),(\d+)\): (.*)$/.exec(line);
  if (!at) continue;
  const guideLine = guideLineFor(at[1]);
  if (guideLine === null) continue;
  mine.push(
    `  creating-an-uplink.md:${guideLine} (${at[1]}:${at[2]}) ${at[4]}`,
  );
}

if (mine.length > 0) {
  console.error(`${mine.length} error(s) in guide examples:\n`);
  for (const line of mine) console.error(line);
  process.exit(1);
}
if (failed && out.trim() !== "") {
  const foreign = out.split("\n").filter((l) => l.includes("error TS")).length;
  console.log(`${foreign} diagnostic(s) outside the extracted blocks, ignored`);
}
console.log(`${checkable.length} ts/tsx block(s) typecheck clean`);
if (!process.argv.includes("--keep"))
  rmSync(work, { recursive: true, force: true });
