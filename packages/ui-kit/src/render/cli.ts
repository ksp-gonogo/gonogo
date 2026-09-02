import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { display, resolveUplinkPackage } from "./context";
import {
  buildManifest,
  buildReadme,
  type DocsInputs,
  scenesAssertingNothing,
} from "./docs";
import { type Engine, renderUplink } from "./driver";
import {
  type AssetShape,
  compareShapes,
  describeStale,
  readShapeRecord,
  SHAPE_RECORD_FILE,
  SHAPE_RECORD_VERSION,
  writeShapeRecord,
} from "./shape";

/**
 * `gonogo-uplink`: the author's whole interface.
 *
 *   gonogo-uplink render                    every scene, to ./renders/
 *   gonogo-uplink render --scene <name>
 *   gonogo-uplink docs                      README.md + gonogo-uplink.json + assets
 *   gonogo-uplink docs --check              CI gate: fail on drift
 *
 * Zero required `package.json` script lines. An Uplink that wants
 * `pnpm ... render` adds one alias.
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
  withModules: string[];
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    verb: argv[0] ?? "",
    root: process.cwd(),
    engine: "chromium",
    assetDir: "docs/assets",
    frames: false,
    check: false,
    withModules: [],
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
      case "--with":
        args.withModules.push(resolve(process.cwd(), value()));
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
  --with <module>        also bundle this module's registrations, on top of
                         package.json's "gonogo.renderWith". For a one-off run;
                         declare the ones a fixture needs every time. Repeatable
`;

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
  if (pkg.renderWith.length > 0) {
    console.log(
      `  hosts   ${pkg.renderWith.map((m) => display(pkg.dir, m)).join(", ")}`,
    );
  }

  if (args.verb === "render") {
    const outDir = resolve(pkg.dir, args.out ?? "renders");
    const result = await renderUplink(pkg, {
      engine: args.engine,
      outDir,
      scene: args.scene,
      frames: args.frames,
      uplinkId: args.uplink,
      withModules: args.withModules,
    });
    reportFont(result.fontMode, result.fontAdvice);
    console.log(`\n${result.assets.length} render(s) → ${outDir}`);
    return;
  }

  if (args.verb !== "docs") {
    throw new Error(`unknown verb "${args.verb}"\n\n${USAGE}`);
  }

  const assetOut = args.check
    ? await mkdtemp(join(tmpdir(), "gonogo-uplink-docs-"))
    : resolve(pkg.dir, args.assetDir);
  const result = await renderUplink(pkg, {
    engine: args.engine,
    outDir: assetOut,
    frames: false,
    uplinkId: args.uplink,
    withModules: args.withModules,
  });
  reportFont(result.fontMode, result.fontAdvice);

  const inputs: DocsInputs = {
    pkg,
    inventory: result.inventory,
    scenes: result.scenes,
    assets: result.assets,
    bundle: args.bundle,
    assetDir: args.assetDir,
  };
  // Reported here rather than on the page. A registration with no fixture gets
  // no image, which the page shows by having none: an explanation of why belongs
  // where the author can act on it, not in the document a reader skims.
  if (result.unpreviewed.length > 0) {
    console.log(
      `  ${result.unpreviewed.length} registration(s) have no fixture, so the ` +
        `page shows no picture of them: ${result.unpreviewed.join(", ")}`,
    );
  }
  const { manifest, warning } = buildManifest(inputs);
  if (warning) console.warn(`\n  warning: ${warning}`);
  const readme = buildReadme(inputs, manifest);
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;

  const readmePath = join(pkg.dir, "README.md");
  const manifestPath = join(pkg.dir, "gonogo-uplink.json");

  const shapes = new Map<string, AssetShape>(
    result.assets.map((asset) => [asset.file, asset.shape]),
  );

  if (!args.check) {
    await writeFile(readmePath, readme, "utf8");
    await writeFile(manifestPath, manifestJson, "utf8");
    await writeShapeRecord(assetOut, {
      version: SHAPE_RECORD_VERSION,
      engine: args.engine,
      assets: Object.fromEntries(shapes),
    });
    console.log(`\nwrote ${display(pkg.dir, readmePath)}`);
    console.log(`wrote ${display(pkg.dir, manifestPath)}`);
    console.log(`wrote ${result.assets.length} asset(s) → ${args.assetDir}/`);
    console.log(`wrote ${args.assetDir}/${SHAPE_RECORD_FILE}`);
    return;
  }

  // The COVERAGE gate. Note what this is NOT: a new check. `assertEveryWidgetCovered`
  // has always THROWN for a widget with no scene, and has always let an AUGMENT off
  // with a line on stdout. That line was drawn when augments were rare, and twelve
  // of RP-1's thirteen registrations are augments, so the strict half stopped
  // covering almost everything. `rp1-warp-targets` sat in the page's Augments table
  // for a day with no renders and `--check` passed every time, because drift asks
  // whether the page matches the code and a registration that renders nothing
  // matches perfectly.
  //
  // So this promotes augments to the rule widgets already live under, against a
  // shrink-only debt list for the ones that predate it. Contributions stay
  // advisory: a contribution supplies a value to a host surface and need not have
  // a look of its own.
  const exempt = await readDocsExempt(pkg.dir);
  const excused = new Set([
    ...Object.keys(exempt.unrenderable ?? {}),
    ...(exempt.sceneDebt ?? []),
  ]);
  const bare = result.unpreviewed
    .filter((entry) => entry.startsWith("augment:"))
    .map((entry) => entry.slice("augment:".length))
    .filter((id) => !excused.has(id));
  if (bare.length > 0) {
    throw new Error(
      `gonogo-uplink docs --check: ${bare.length} augment(s) declare no render ` +
        `scene, so no reviewer can ever see them:\n  ${bare.join("\n  ")}\n\n` +
        "Add a `_scene` fixture under the widget's `__fixtures__/`, showing a state " +
        "worth reviewing rather than the happy path.\n\n" +
        "COVERAGE IS NOT CORRECTNESS: a registration with four scenes can still hide " +
        "its interesting state, which is exactly how RP-1's dismantle warnings stayed " +
        "invisible with four scenes already committed. This only says somebody CAN look.",
    );
  }

  const unasserted = scenesAssertingNothing(inputs);
  if (unasserted.length > 0) {
    console.warn(
      `\n  warning: ${unasserted.length} scene(s) declare no "_scene.paints", so they ` +
        "assert nothing about what the render says:\n    " +
        unasserted.join("\n    ") +
        "\n  A scene that asserts nothing is a picture nobody has read. `paints` is " +
        "what catches a sentence that silently stopped appearing.",
    );
  }

  const differences: string[] = [];
  await compareText(readmePath, readme, differences);
  await compareText(manifestPath, manifestJson, differences);
  await compareAssetNames(
    resolve(pkg.dir, args.assetDir),
    assetOut,
    differences,
  );
  compareCommittedShapes(
    resolve(pkg.dir, args.assetDir),
    shapes,
    args.engine,
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

/**
 * One Uplink's declared render exemptions, from `docs-exempt.json` beside its
 * `package.json`.
 *
 * <p><b>Per-Uplink rather than a list in here, and that is the whole point.</b> The
 * first draft of this gate carried two central sets naming the offending augments,
 * and `uplink-boundary` refused it, correctly: a shared tool naming an individual
 * Uplink's augment ids couples `ui-kit` to code it must not know about, which is
 * the same complaint this project has about allowlists generally. So the exemption lives
 * WITH the code it describes, and the reason sits where the person who would
 * change it will read it.</p>
 *
 * <p>Two kinds, because conflating them is how a debt list becomes an allowlist:</p>
 * <ul>
 *   <li><b>`unrenderable`</b> is permanent and needs a reason. `assertEveryWidgetCovered`
 *   has always let augments off, and its own test says why: an overlay augment draws
 *   in its host's projection, so a stand-in panel gives it nothing to draw against
 *   and demanding a fixture would be demanding a picture that cannot be honest.</li>
 *   <li><b>`sceneDebt`</b> is temporary and needs a SCENE. Entries here predate the
 *   gate; the file is expected to shrink and a new entry means new code created the
 *   very problem the gate exists to stop.</li>
 * </ul>
 */
interface DocsExempt {
  unrenderable?: Record<string, string>;
  sceneDebt?: string[];
}

async function readDocsExempt(dir: string): Promise<DocsExempt> {
  try {
    return JSON.parse(
      await readFile(join(dir, "docs-exempt.json"), "utf8"),
    ) as DocsExempt;
  } catch {
    // Absent is the normal case and means "every augment must render".
    return {};
  }
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

/**
 * Whether the committed pictures are pictures of this code.
 *
 * The rest of `--check` compares the prose and the asset FILENAMES, and on a page
 * whose content is almost entirely images that is a gate missing its subject:
 * Vehicle Assembly's page showed a layout the code had stopped producing for five
 * commits and every run agreed it was current.
 *
 * A missing record is REPORTED and not failed. The mechanism arrives after ten
 * Uplinks have been generated without it, and failing all ten on the first run
 * would be a wall of red that says nothing about which of them a person just
 * broke. `scripts/uplink-shape-debt.mjs` holds that count and only lets it
 * shrink.
 */
function compareCommittedShapes(
  assetDir: string,
  rendered: ReadonlyMap<string, AssetShape>,
  engine: string,
  out: string[],
): void {
  let record: ReturnType<typeof readShapeRecord>;
  try {
    record = readShapeRecord(assetDir);
  } catch (err) {
    out.push(
      `${SHAPE_RECORD_FILE}: ${err instanceof Error ? err.message : err}`,
    );
    return;
  }
  const verdict = compareShapes(record, rendered, engine);
  if (verdict.incomparable) {
    console.warn(`\n  warning: ${SHAPE_RECORD_FILE} ${verdict.incomparable}`);
    return;
  }
  for (const entry of verdict.stale) out.push(describeStale(entry));
  if (verdict.unrecorded.length > 0) {
    console.warn(
      `\n  warning: ${verdict.unrecorded.length} asset(s) have no recorded ` +
        "shape, so nothing here can say whether their pictures match the code. " +
        `Run \`pnpm uplink-docs\` to record them: ${verdict.unrecorded.join(", ")}`,
    );
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
