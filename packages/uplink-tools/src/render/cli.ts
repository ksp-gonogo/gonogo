import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { UplinkInventory } from "../render-probe";
import {
  display,
  readJsonObject,
  resolveRenderModule,
  resolveUplinkPackage,
  type UplinkPackage,
} from "./context";
import {
  buildManifest,
  buildReadme,
  type DocsInputs,
  linkedAssets,
  README_GENERATED_MARKER,
  scenesAssertingNothing,
  widgetRecordsOf,
} from "./docs";
import { type Engine, readUplinkScenes, renderUplink } from "./driver";
import { RENDERED_FILES_RECORD, recordedRenders } from "./rendered-files";
import {
  type AssetShape,
  compareShapes,
  describeStale,
  readShapeRecord,
  SHAPE_RECORD_FILE,
  SHAPE_RECORD_VERSION,
  type ShapeVerdict,
  writeShapeRecord,
} from "./shape";
import { buildUplinkSpec, SPEC_FILE, uplinkSpecJson } from "./spec";
import { usageOf } from "./usage";
import { WIDGET_RECORDS_FILE, widgetRecordsJson } from "./widgetRecord";
import { readWireSurface } from "./wire";

/**
 * What to do about a stale page, and it is not the obvious thing.
 *
 * "Run `uplink-tools docs` and commit the result" would be wrong twice on a
 * developer's machine. It re-rasterises every picture
 * locally, and a picture rendered on the wrong OS is the same mistake as a
 * locally-rendered visual baseline. And `docs` first removes the pictures its previous
 * run recorded, so a run that throws part-way leaves those committed pictures
 * deleted and the shape record intact, which then reads as missing assets.
 *
 * The prose half has no such hazard and needs no browser at all, so it is named
 * first and separately: most stale pages are stale in their text.
 */
const REGENERATE_REMEDY =
  "The prose is browserless and safe to regenerate anywhere, by running the " +
  "client's\n  tests with the update variable set:\n" +
  "    GONOGO_UPLINK_PAGE_UPDATE=1 npx vitest run\n\n" +
  "  The PICTURES are regenerated on Linux, and committed with the change:\n" +
  "    npx uplink-tools docs\n\n" +
  "  (Inside the gonogo repository those are `pnpm uplink-pages` and " +
  "`pnpm uplink-docs`.)\n" +
  "  `uplink-tools docs` regenerates both on THIS machine's rasteriser, " +
  "and it\n  first removes the pictures its last run recorded in " +
  "`.uplink-tools-renders.json`: a run\n  that throws leaves those deleted. " +
  "Recover with `git checkout -- docs/assets`.\n" +
  "  Commit `docs/assets/.uplink-tools-renders.json` with the pictures: it is what lets a run on " +
  "another\n  machine remove the picture of a scene that no longer exists.";

/**
 * The browser verbs of `uplink-tools`:
 *
 *   uplink-tools render                    every scene, to ./renders/
 *   uplink-tools render --scene <name>
 *   uplink-tools docs                      README.md + gonogo-uplink.json + assets
 *   uplink-tools docs --check              fail on drift; pictures on CI only
 *   uplink-tools docs --no-assets          README.md + gonogo-uplink.json only
 *
 * Zero required `package.json` script lines. An Uplink that wants
 * `pnpm ... render` adds one alias.
 */

const ENGINES = new Set(["chromium", "firefox", "webkit"]);

/** The flags only one verb reads, so the other refuses them rather than ignoring them. */
const VERB_ONLY_FLAGS: Readonly<Record<string, readonly string[]>> = {
  render: ["--scene", "--frames", "--out"],
  docs: ["--bundle", "--assets", "--check", "--no-assets"],
};

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
  noAssets: boolean;
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
    noAssets: false,
    withModules: [],
  };
  const given = new Set<string>();
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i];
    given.add(flag);
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
        // Through the same resolver as `gonogo.renderWith`, so the flag and the
        // declaration accept the same two shapes. Relative to the cwd rather
        // than to `--root`, which is what a flag typed by hand means.
        args.withModules.push(
          resolveRenderModule(process.cwd(), "--with", value()),
        );
        break;
      case "--frames":
        args.frames = true;
        break;
      case "--check":
        args.check = true;
        break;
      case "--no-assets":
        args.noAssets = true;
        break;
      default:
        throw new Error(
          `${flag} is not an option of ${args.verb}\n\n${usageOf(args.verb)}`,
        );
    }
  }
  for (const [verb, flags] of Object.entries(VERB_ONLY_FLAGS)) {
    if (verb === args.verb || !(args.verb in VERB_ONLY_FLAGS)) continue;
    const misplaced = flags.find((flag) => given.has(flag));
    if (misplaced) {
      throw new Error(
        `${misplaced} only applies to ${verb}\n\n${usageOf(args.verb)}`,
      );
    }
  }
  if (args.noAssets && args.check) {
    throw new Error(
      "--no-assets and --check do not combine: the prose half of the check " +
        "is `expectUplinkPageCurrent` in the Uplink's own test suite, and " +
        "`docs --check` exists for the pictures.",
    );
  }
  return args;
}

const WIDGETS_SPECIFIER = "@ksp-gonogo/uplink-tools/widgets";

/**
 * Warns when the package that draws host widgets for the docs page is listed in
 * the Uplink's `dependencies`. It belongs in `devDependencies`, because in
 * `dependencies` it ships with the Uplink and invites imports of the app's
 * widgets. Useful for keeping an Uplink's published client free of docs-only
 * packages. Used by the `docs` and `render` commands.
 */
export function warnWidgetsInDependencies(dir: string): void {
  const manifest = readJsonObject(join(dir, "package.json"));
  const dependencies = manifest.dependencies;
  if (typeof dependencies !== "object" || dependencies === null) return;
  if (!("@ksp-gonogo/uplink-tools" in dependencies)) return;
  const { gonogo } = manifest;
  const renderWith =
    typeof gonogo === "object" && gonogo !== null && "renderWith" in gonogo
      ? gonogo.renderWith
      : undefined;
  if (!Array.isArray(renderWith) || !renderWith.includes(WIDGETS_SPECIFIER)) {
    return;
  }
  console.warn(
    `  warning: "@ksp-gonogo/uplink-tools" is in dependencies of ${join(dir, "package.json")}, ` +
      `and "gonogo.renderWith" names ${WIDGETS_SPECIFIER}.\n` +
      "  Move it to devDependencies: it draws host widgets for the docs page and must not ship with the Uplink.",
  );
}

/**
 * Runs `render` or `docs`, with `argv[0]` naming which, and throws on any
 * failure. Useful for drawing every widget of an Uplink and, for `docs`,
 * writing and checking the page an operator reads. Used by the `uplink-tools`
 * command line.
 */
export async function renderOrDocs(argv: readonly string[]): Promise<void> {
  // Anywhere in the line, so `--help` never reaches `parseArgs` as an unknown flag.
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usageOf(argv[0] ?? ""));
    return;
  }
  const args = parseArgs(argv);
  const pkg = resolveUplinkPackage(args.root, { entry: args.entry });
  warnWidgetsInDependencies(pkg.dir);
  console.log(`${pkg.name} @ ${pkg.dir}`);
  console.log(`  entry   ${display(pkg.dir, pkg.entry)}`);
  console.log(
    `  setup   ${pkg.setup ? display(pkg.dir, pkg.setup) : "(none)"}`,
  );
  console.log(`  fixtures ${pkg.fixtures.length}`);
  if (pkg.renderWith.length > 0) {
    console.log(
      // A specifier prints as itself. Through `display` it would come out as a
      // relative PATH to a directory of that name, which is not where it is.
      `  hosts   ${pkg.renderWith
        .map((m) => (m.startsWith("/") ? display(pkg.dir, m) : m))
        .join(", ")}`,
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
    throw new Error(`unknown verb "${args.verb}"`);
  }

  if (args.noAssets) {
    await writeProseOnly(pkg, args);
    return;
  }

  if (!args.check) {
    await docs(pkg, args, resolve(pkg.dir, args.assetDir));
    return;
  }
  const scratch = await mkdtemp(join(tmpdir(), "gonogo-uplink-docs-"));
  try {
    await docs(pkg, args, scratch);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** The spec sheet's text for an Uplink, from the same inventory the README is built from. */
function specJsonOf(pkg: UplinkPackage, inventory: UplinkInventory): string {
  return uplinkSpecJson(
    buildUplinkSpec(
      pkg,
      inventory,
      readWireSurface(pkg.dir),
      widgetRecordsOf(inventory),
    ),
  );
}

/** `docs` writes the page with its assets rendered into `assetOut`; `docs --check` compares against it instead. */
async function docs(
  pkg: UplinkPackage,
  args: Args,
  assetOut: string,
): Promise<void> {
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
  // A check never compares integrity, so the warning about an empty one would be noise on every run.
  if (warning && !args.check) console.warn(`\n  warning: ${warning}`);
  const readme = buildReadme(inputs, manifest);
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  const recordsJson = widgetRecordsJson(widgetRecordsOf(result.inventory));
  const specJson = specJsonOf(pkg, result.inventory);

  const readmePath = join(pkg.dir, "README.md");
  const manifestPath = join(pkg.dir, "gonogo-uplink.json");
  const recordsPath = join(pkg.dir, WIDGET_RECORDS_FILE);
  const specPath = join(pkg.dir, SPEC_FILE);

  const shapes = new Map<string, AssetShape>(
    result.assets.map((asset) => [asset.file, asset.shape]),
  );

  if (!args.check) {
    await refuseToClobberHandWrittenReadme(pkg.dir, readmePath);
    await writeFile(readmePath, readme, "utf8");
    await writeFile(manifestPath, manifestJson, "utf8");
    await mkdir(dirname(recordsPath), { recursive: true });
    await writeFile(recordsPath, recordsJson, "utf8");
    await writeFile(specPath, specJson, "utf8");
    await writeShapeRecord(assetOut, {
      version: SHAPE_RECORD_VERSION,
      engine: args.engine,
      assets: Object.fromEntries(shapes),
    });
    console.log(`\nwrote ${display(pkg.dir, readmePath)}`);
    console.log(`wrote ${display(pkg.dir, manifestPath)}`);
    console.log(`wrote ${WIDGET_RECORDS_FILE}`);
    console.log(`wrote ${SPEC_FILE}`);
    console.log(`wrote ${result.assets.length} asset(s) → ${args.assetDir}/`);
    console.log(`wrote ${args.assetDir}/${SHAPE_RECORD_FILE}`);
    return;
  }

  // The COVERAGE gate. Note what this is NOT: a new check. `assertEveryWidgetCovered`
  // has always THROWN for a widget with no scene, and has always let an AUGMENT off
  // with a line on stdout. That line was drawn when augments were rare, and twelve
  // of one Uplink's thirteen registrations are augments, so the strict half
  // stopped covering almost everything. One of those augments sat in the page's Augments table
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
      `uplink-tools docs --check: ${bare.length} augment(s) declare no render ` +
        `scene, so no reviewer can ever see them:\n  ${bare.join("\n  ")}\n\n` +
        "Add a `_scene` fixture under the widget's `__fixtures__/`, showing a state " +
        "worth reviewing rather than the happy path.\n\n" +
        "COVERAGE IS NOT CORRECTNESS: a registration with four scenes can still hide " +
        "its interesting state, which is exactly how one Uplink's dismantle warnings stayed " +
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

  const { differences, wholePage } = await compareCommittedPage({
    readmePath,
    readme,
    manifestPath,
    manifestJson,
    recordsPath,
    recordsJson,
    specPath,
    specJson,
    committedAssets: resolve(pkg.dir, args.assetDir),
    generatedAssets: assetOut,
    shapes,
    engine: args.engine,
    pictures: picturesComparedHere(process.env),
  });
  if (differences.length > 0) {
    throw new Error(
      `uplink-tools docs --check: ${differences.length} difference(s) ` +
        `between the committed page and what the code says today:\n  ` +
        `${differences.join("\n  ")}\n\n` +
        (wholePage ? `${wholePage}\n\n` : "") +
        REGENERATE_REMEDY,
    );
  }
  console.log("\ndocs --check: the committed page matches the code.");
}

/**
 * `docs --no-assets`: the page's text, and nothing under the asset directory.
 *
 * The prose links every picture by name, so it can be written from the scenes
 * without rendering one, and the names come from the same rule the renderer
 * follows. The pictures a new scene links are then missing until the next
 * regeneration on the machine whose renders are committed, which `docs --check`
 * reports as a missing asset rather than hiding. The shape record is left alone
 * for the same reason: it describes the committed pictures, and none of them moved.
 */
async function writeProseOnly(pkg: UplinkPackage, args: Args): Promise<void> {
  const read = await readUplinkScenes(pkg, {
    engine: args.engine,
    uplinkId: args.uplink,
    withModules: args.withModules,
  });
  const inputs: DocsInputs = {
    pkg,
    inventory: read.inventory,
    scenes: read.scenes,
    assets: linkedAssets(read.scenes),
    bundle: args.bundle,
    assetDir: args.assetDir,
  };
  const { manifest, warning } = buildManifest(inputs);
  if (warning) console.warn(`\n  warning: ${warning}`);
  const readmePath = join(pkg.dir, "README.md");
  const manifestPath = join(pkg.dir, "gonogo-uplink.json");
  await refuseToClobberHandWrittenReadme(pkg.dir, readmePath);
  await writeFile(readmePath, buildReadme(inputs, manifest), "utf8");
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  const recordsPath = join(pkg.dir, WIDGET_RECORDS_FILE);
  await mkdir(dirname(recordsPath), { recursive: true });
  await writeFile(
    recordsPath,
    widgetRecordsJson(widgetRecordsOf(read.inventory)),
    "utf8",
  );
  await writeFile(
    join(pkg.dir, SPEC_FILE),
    specJsonOf(pkg, read.inventory),
    "utf8",
  );
  console.log(`\nwrote ${display(pkg.dir, readmePath)}`);
  console.log(`wrote ${display(pkg.dir, manifestPath)}`);
  console.log(`wrote ${WIDGET_RECORDS_FILE}`);
  console.log(`wrote ${SPEC_FILE}`);
  console.log(`left ${args.assetDir}/ untouched`);
}

/**
 * One Uplink's declared render exemptions, from `docs-exempt.json` beside its
 * `package.json`.
 *
 * **Per-Uplink rather than a list in here, and that is the whole point.** The
 * first draft of this gate carried two central sets naming the offending augments,
 * and `uplink-boundary` refused it, correctly: a shared tool naming an individual
 * Uplink's augment ids couples `ui-kit` to code it must not know about, which is
 * the same complaint this project has about allowlists generally. So the exemption lives
 * with the code it describes, and the reason sits where the person who would
 * change it will read it.
 *
 * Two kinds, because conflating them is how a debt list becomes an allowlist:
 * - **`unrenderable`** is permanent and needs a reason. `assertEveryWidgetCovered`
 *   has always let augments off, and its own test says why: an overlay augment draws
 *   in its host's projection, so a stand-in panel gives it nothing to draw against
 *   and demanding a fixture would be demanding a picture that cannot be honest.
 * - **`sceneDebt`** is temporary and needs a scene. Entries here predate the
 *   gate; the file is expected to shrink and a new entry means new code created the
 *   very problem the gate exists to stop.
 */
interface DocsExempt {
  unrenderable?: Record<string, string>;
  sceneDebt?: string[];
}

async function readDocsExempt(dir: string): Promise<DocsExempt> {
  const file = join(dir, "docs-exempt.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch {
    // Absent is the normal case and means "every augment must render".
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${file} does not hold a JSON object.`);
  }
  return parsed as DocsExempt;
}

/**
 * Throws instead of overwriting a `README.md` that the `docs` command did not
 * write. Useful for protecting a readme an author wrote by hand when they run
 * `docs` for the first time. Used by the `docs` command before it writes the
 * page.
 *
 * `docs` generates the README from the registrations, so it replaces one it
 * generated before. The generated file carries a marker on its first line, so
 * a package `docs` has generated once never sees this refusal again. To
 * proceed, move the hand-written readme aside.
 */
export async function refuseToClobberHandWrittenReadme(
  dir: string,
  readmePath: string,
): Promise<void> {
  if (!existsSync(readmePath)) return;
  const existing = await readFile(readmePath, "utf8");
  if (existing.startsWith(README_GENERATED_MARKER)) return;
  throw new Error(
    `uplink-tools: ${display(dir, readmePath)} was not written by ` +
      "`uplink-tools docs` or `uplink-tools page`, and the page it generates would replace the whole file.\n\n" +
      "Everything a generated page says comes from your registrations, your " +
      "contract slice and your fixtures, so there is nowhere in it for prose " +
      "to survive. Move what you want to keep somewhere the generator does " +
      "not write (docs/, or the repository root's own README), then run this " +
      "again:\n" +
      `  git mv ${display(dir, readmePath)} NOTES.md\n\n` +
      "Every README they write opens with " +
      `"${README_GENERATED_MARKER}", which is how it recognises its own.`,
  );
}

function reportFont(mode: string, advice?: string): void {
  console.log(`\n  font: ${mode}`);
  if (advice) console.warn(`  warning: ${advice}`);
}

/**
 * Whether this run compares the committed pictures' shapes: true only on CI.
 * The committed pictures and their shape record are generated on the Linux CI
 * runner, and a shape read on any other machine differs from it in ways nobody
 * edited, so the comparison depends on being CI and never on the operating
 * system. Useful for keeping `docs --check` from failing on a laptop. Used by
 * the `docs` command's check.
 */
export function picturesComparedHere(env: NodeJS.ProcessEnv): boolean {
  if (env.GITHUB_ACTIONS === "true") return true;
  const ci = env.CI?.trim().toLowerCase();
  return ci !== undefined && ci !== "" && ci !== "0" && ci !== "false";
}

export const PICTURES_ARE_CI_NOTE =
  "docs --check: pictures and their shapes are compared in CI only; this run compared the README, the manifest, docs/widgets.json, docs/spec.json and the asset names.";

export interface CommittedPage {
  readmePath: string;
  readme: string;
  manifestPath: string;
  manifestJson: string;
  /** Where the widget records belong, and what they should hold. */
  recordsPath: string;
  recordsJson: string;
  /** Where the spec sheet belongs, and what it should hold. */
  specPath: string;
  specJson: string;
  committedAssets: string;
  generatedAssets: string;
  shapes: ReadonlyMap<string, AssetShape>;
  engine: string;
  /** Compare the pictures' shapes too. See {@link picturesComparedHere}. */
  pictures: boolean;
}

/**
 * Every difference between the committed page and what the code says today.
 * The text and the asset names are always compared; the picture shapes are
 * compared only when `pictures` is set. Useful for telling the author which
 * parts of the generated page are stale. Used by the `docs` command's check.
 */
export async function compareCommittedPage(
  page: CommittedPage,
): Promise<{ differences: string[]; wholePage?: string }> {
  const differences: string[] = [];
  await compareText(page.readmePath, page.readme, differences);
  await compareText(page.manifestPath, page.manifestJson, differences);
  await compareText(page.recordsPath, page.recordsJson, differences);
  await compareText(page.specPath, page.specJson, differences);
  await compareAssetNames(
    page.committedAssets,
    page.generatedAssets,
    differences,
  );
  compareRenderRecord(page.committedAssets, page.generatedAssets, differences);
  if (!page.pictures) {
    console.log(`\n${PICTURES_ARE_CI_NOTE}`);
    return { differences };
  }
  const wholePage = compareCommittedShapes(
    page.committedAssets,
    page.shapes,
    page.engine,
    differences,
  );
  return { differences, wholePage };
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
 * Compares the names of the committed pictures with the names the code would
 * generate, never their bytes. A missing or extra picture is a widget added
 * without a fixture, or a fixture deleted with its picture left behind. A PNG's
 * bytes differ by engine and operating system, so they are not compared. Useful
 * for telling the author which pictures to add or remove. Used by
 * `compareCommittedPage`.
 */
export async function compareAssetNames(
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
 * Compares the committed list of rendered pictures with the list a fresh run
 * writes. Pictures with no list, or a list naming other files, are the state in
 * which a later run on another machine cannot remove the picture of a scene that
 * no longer exists. Useful for telling the author to commit the list with the
 * pictures. Used by `compareCommittedPage`.
 */
export function compareRenderRecord(
  committed: string,
  generated: string,
  out: string[],
): void {
  const want = recordedRenders(generated);
  if (want.length === 0) return;
  const have = recordedRenders(committed);
  const path = join(committed, RENDERED_FILES_RECORD);
  if (!existsSync(path)) {
    out.push(
      `${path} does not exist: commit it with the pictures, so a later run can remove the picture of a scene that is gone`,
    );
    return;
  }
  const missing = want.filter((name) => !have.includes(name));
  const extra = have.filter((name) => !want.includes(name));
  if (missing.length === 0 && extra.length === 0) return;
  out.push(
    `${path} names other files than the pictures this code draws` +
      (missing.length > 0 ? `; not listed: ${missing.join(", ")}` : "") +
      (extra.length > 0 ? `; listed but not drawn: ${extra.join(", ")}` : ""),
  );
}

/**
 * Whether the committed pictures are pictures of this code.
 *
 * The rest of `--check` compares the prose and the asset filenames, and on a page
 * whose content is almost entirely images that is a gate missing its subject:
 * Vehicle Assembly's page showed a layout the code had stopped producing for five
 * commits and every run agreed it was current.
 *
 * A missing record is reported and not failed. The mechanism arrives after ten
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
): string | undefined {
  let record: ReturnType<typeof readShapeRecord>;
  try {
    record = readShapeRecord(assetDir);
  } catch (err) {
    out.push(
      `${SHAPE_RECORD_FILE}: ${err instanceof Error ? err.message : err}`,
    );
    return undefined;
  }
  const verdict = compareShapes(record, rendered, engine);
  if (verdict.incomparable) {
    console.warn(`\n  warning: ${SHAPE_RECORD_FILE} ${verdict.incomparable}`);
    return undefined;
  }
  for (const entry of verdict.stale) out.push(describeStale(entry));
  if (verdict.unrecorded.length > 0) {
    console.warn(
      `\n  warning: ${verdict.unrecorded.length} asset(s) have no recorded ` +
        "shape, so nothing here can say whether their pictures match the code. " +
        `Run \`uplink-tools docs\` on Linux to record them: ${verdict.unrecorded.join(", ")}`,
    );
  }
  return wholePageRestyle(verdict, rendered.size);
}

/**
 * A note saying the whole page was restyled, or `undefined` when it was not.
 * It applies only when every recorded asset is stale and none of them changed
 * in its element tree or its text, which is what a theme token edit produces
 * and a single widget edit does not. Useful for telling the author that every
 * picture changed for one shared reason, such as a new theme token. Used by
 * the `docs` command's check when it reports stale pictures.
 */
export function wholePageRestyle(
  verdict: ShapeVerdict,
  renderedCount: number,
): string | undefined {
  const recorded = renderedCount - verdict.unrecorded.length;
  if (verdict.stale.length === 0 || verdict.stale.length !== recorded) {
    return undefined;
  }
  const restyled = verdict.stale.every(
    (entry) =>
      entry.was.elements === entry.now.elements &&
      entry.was.text === entry.now.text,
  );
  if (!restyled) return undefined;
  return (
    `All ${recorded} recorded asset(s) moved, and not one moved in its tree or ` +
    "its text. That is what a kit or theme change looks like from here, not a\n" +
    "  change to any one widget: a token reaches every element of every page at " +
    "once. Expect it after a `packages/theme` or `packages/ui-kit` edit, and " +
    "expect\n  the scheduled regeneration to clear it."
  );
}
