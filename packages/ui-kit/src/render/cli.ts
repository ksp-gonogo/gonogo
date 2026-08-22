import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { display, resolveUplinkPackage } from "./context";
import {
  assertProseTargetsExist,
  buildManifest,
  buildReadme,
  type DocsInputs,
  type Prose,
  parseProse,
} from "./docs";
import { type Engine, renderUplink } from "./driver";

/**
 * `gonogo-uplink`: the author's whole interface.
 *
 *   gonogo-uplink render                    every scene, to ./renders/
 *   gonogo-uplink render --scene <name>
 *   gonogo-uplink docs                      README.md + gonogo-uplink.json + assets
 *   gonogo-uplink docs --check              CI gate: fail on drift
 *
 * Zero required `package.json` script lines. An Uplink that wants
 * `pnpm … render` adds one alias.
 */

const ENGINES = new Set(["chromium", "firefox", "webkit"]);

interface Args {
  verb: string;
  root: string;
  entry?: string;
  uplink?: string;
  scene?: string;
  engine: Engine;
  out?: string;
  assetDir: string;
  bundle?: string;
  frames: boolean;
  check: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    verb: argv[0] ?? "",
    root: process.cwd(),
    engine: "chromium",
    assetDir: "docs/assets",
    frames: false,
    check: false,
  };
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      return next;
    };
    switch (flag) {
      case "--root":
        args.root = resolve(process.cwd(), value());
        break;
      case "--entry":
        args.entry = value();
        break;
      case "--uplink":
        args.uplink = value();
        break;
      case "--scene":
        args.scene = value();
        break;
      case "--engine": {
        const engine = value();
        if (!ENGINES.has(engine)) {
          throw new Error(
            `--engine must be one of ${[...ENGINES].join(", ")}, got "${engine}"`,
          );
        }
        args.engine = engine as Engine;
        break;
      }
      case "--out":
        args.out = value();
        break;
      case "--assets":
        args.assetDir = value();
        break;
      case "--bundle":
        args.bundle = value();
        break;
      case "--frames":
        args.frames = true;
        break;
      case "--check":
        args.check = true;
        break;
      default:
        throw new Error(`unknown flag "${flag}"`);
    }
  }
  return args;
}

const USAGE = `gonogo-uplink <render|docs> [options]

  render                 render every fixture to ./renders/
  docs                   write README.md, gonogo-uplink.json and docs/assets/
  docs --check           regenerate in memory and fail on any difference

  --root <dir>           the Uplink client package (default: cwd)
  --entry <file>         the client entry to bundle (default: src/index.ts)
  --uplink <id>          which declared client, when the bundle has several
  --scene <name>         one fixture only
  --engine <e>           chromium | firefox | webkit
  --out <dir>            render output (default: renders/)
  --assets <dir>         docs asset output (default: docs/assets)
  --bundle <file>        the file you distribute, hashed into integrity
  --frames               keep the numbered PNGs of a motion scene
`;

async function loadProse(file: string | undefined): Promise<Prose> {
  if (!file) {
    throw new Error(
      "gonogo-uplink docs: no uplink.md beside package.json.\n\n" +
        "It is the ONE file you write, and the page needs it: everything else " +
        "on the page is derived from your registrations, and a page with no " +
        "sentence saying what the Uplink is for is a page nobody reads.\n\n" +
        "Create uplink.md with a lede (what this Uplink is for, which mod it " +
        "integrates, install notes), and optional `## widget:<id>` sections " +
        "adding prose to one registration.",
    );
  }
  return parseProse(await readFile(file, "utf8"));
}

async function main(argv: readonly string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    console.log(USAGE);
    return;
  }
  const args = parseArgs(argv);
  const pkg = resolveUplinkPackage(args.root, { entry: args.entry });
  console.log(`${pkg.name} @ ${pkg.dir}`);
  console.log(`  entry   ${display(pkg.dir, pkg.entry)}`);
  console.log(
    `  setup   ${pkg.setup ? display(pkg.dir, pkg.setup) : "(none)"}`,
  );
  console.log(`  fixtures ${pkg.fixtures.length}`);

  if (args.verb === "render") {
    const outDir = resolve(pkg.dir, args.out ?? "renders");
    const result = await renderUplink(pkg, {
      engine: args.engine,
      outDir,
      scene: args.scene,
      frames: args.frames,
      uplinkId: args.uplink,
    });
    reportFont(result.fontMode, result.fontAdvice);
    console.log(`\n${result.assets.length} render(s) → ${outDir}`);
    return;
  }

  if (args.verb !== "docs") {
    throw new Error(`unknown verb "${args.verb}"\n\n${USAGE}`);
  }

  const prose = await loadProse(pkg.prose);
  const assetOut = args.check
    ? await mkdtemp(join(tmpdir(), "gonogo-uplink-docs-"))
    : resolve(pkg.dir, args.assetDir);
  const result = await renderUplink(pkg, {
    engine: args.engine,
    outDir: assetOut,
    frames: false,
    uplinkId: args.uplink,
  });
  reportFont(result.fontMode, result.fontAdvice);
  assertProseTargetsExist(prose, result.inventory);

  const inputs: DocsInputs = {
    pkg,
    inventory: result.inventory,
    scenes: result.scenes,
    assets: result.assets,
    prose,
    bundle: args.bundle,
    assetDir: args.assetDir,
    unpreviewed: result.unpreviewed,
  };
  if (result.unpreviewed.length > 0) {
    console.log(
      `  ${result.unpreviewed.length} registration(s) listed without a ` +
        `preview: ${result.unpreviewed.join(", ")}`,
    );
  }
  const { manifest, warning } = buildManifest(inputs);
  if (warning) console.warn(`\n  warning: ${warning}`);
  const readme = buildReadme(inputs, manifest);
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;

  const readmePath = join(pkg.dir, "README.md");
  const manifestPath = join(pkg.dir, "gonogo-uplink.json");

  if (!args.check) {
    await writeFile(readmePath, readme, "utf8");
    await writeFile(manifestPath, manifestJson, "utf8");
    console.log(`\nwrote ${display(pkg.dir, readmePath)}`);
    console.log(`wrote ${display(pkg.dir, manifestPath)}`);
    console.log(`wrote ${result.assets.length} asset(s) → ${args.assetDir}/`);
    return;
  }

  const differences: string[] = [];
  await compareText(readmePath, readme, differences);
  await compareText(manifestPath, manifestJson, differences);
  await compareAssetNames(
    resolve(pkg.dir, args.assetDir),
    assetOut,
    differences,
  );
  if (differences.length > 0) {
    throw new Error(
      `gonogo-uplink docs --check: ${differences.length} difference(s) ` +
        `between the committed page and what the code says today:\n  ` +
        `${differences.join("\n  ")}\n\n` +
        "Run `gonogo-uplink docs` and commit the result.",
    );
  }
  console.log("\ndocs --check: the committed page matches the code.");
}

function reportFont(mode: string, advice?: string): void {
  console.log(`\n  font: ${mode}`);
  if (advice) console.warn(`  warning: ${advice}`);
}

async function compareText(
  file: string,
  expected: string,
  out: string[],
): Promise<void> {
  if (!existsSync(file)) {
    out.push(`${file} does not exist`);
    return;
  }
  const actual = await readFile(file, "utf8");
  if (actual === expected) return;
  const actualLines = actual.split("\n");
  const expectedLines = expected.split("\n");
  const at = actualLines.findIndex((line, i) => line !== expectedLines[i]);
  out.push(
    `${file} differs at line ${at + 1}:\n` +
      `      committed: ${JSON.stringify(actualLines[at] ?? "(end of file)")}\n` +
      `      generated: ${JSON.stringify(expectedLines[at] ?? "(end of file)")}`,
  );
}

/**
 * Names, not bytes.
 *
 * A missing or extra asset is real drift: a widget added without a fixture, or a
 * fixture deleted and its picture left behind. Rasterisation is per-engine and
 * per-OS, so byte-comparing a PNG here would fail on any machine but the one
 * that generated it, which is a gate that cries wolf and then gets turned off.
 */
async function compareAssetNames(
  committed: string,
  generated: string,
  out: string[],
): Promise<void> {
  const read = async (dir: string) => {
    try {
      return new Set(
        (await readdir(dir)).filter(
          (f) => f.endsWith(".png") || f.endsWith(".gif"),
        ),
      );
    } catch {
      return new Set<string>();
    }
  };
  const have = await read(committed);
  const want = await read(generated);
  for (const name of [...want].sort()) {
    if (!have.has(name)) out.push(`${committed}: missing asset ${name}`);
  }
  for (const name of [...have].sort()) {
    if (!want.has(name)) out.push(`${committed}: stale asset ${name}`);
  }
}

export async function run(argv: readonly string[]): Promise<number> {
  try {
    await main(argv);
    return 0;
  } catch (err) {
    console.error(`\n${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
