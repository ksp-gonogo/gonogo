import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readInventory } from "@ksp-gonogo/uplink-tools/render-probe";
import { PAGE_WRITE_ENV } from "./page-write-env";
import {
  display,
  renderModuleUrl,
  resolveUplinkPackage,
} from "./render/context";
import {
  buildManifest,
  buildReadme,
  linkedAssets,
  widgetRecordsOf,
} from "./render/docs";
import { assertEveryWidgetCovered, buildScenes } from "./render/scenes";
import { WIDGET_RECORDS_FILE, widgetRecordsJson } from "./render/widgetRecord";

/*
 * The browserless half of `uplink-tools docs --check`: whether the generated page still matches what the registrations declare.
 * It reads through the same `readInventory` and `buildReadme` the renderer uses, so it cannot describe a different Uplink from the pictures.
 */

/**
 * Where `checkUplinkPage` and `writeUplinkPage` find the Uplink.
 *
 * @category Page check
 */
export interface PageCheckOptions {
  /** The Uplink client package. Defaults to the working directory. */
  root?: string;
  /** Which declared client, when the bundle carries several. */
  uplink?: string;
}

/**
 * What `checkUplinkPage` found: one line per generated file that no longer
 * matches.
 *
 * @category Page check
 */
export interface PageCheckResult {
  differences: string[];
}

/**
 * Everything the manifest carries EXCEPT the one field that is a fact about a
 * release artifact rather than about the page.
 *
 * `integrity` is the sha256 of the file the author distributes, stamped at
 * release time with `--bundle`. A working copy has no such file, so a test that
 * compared it would fail on every commit between releases and pass only on the
 * one that cut one.
 */
function withoutIntegrity(json: string): string {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("uplink-tools: the manifest does not hold a JSON object.");
  }
  const manifest: Record<string, unknown> = parsed as Record<string, unknown>;
  delete manifest.integrity;
  return JSON.stringify(manifest, null, 2);
}

/** The generated files of a page, and where they belong. */
interface GeneratedPage {
  readmePath: string;
  readme: string;
  manifestPath: string;
  manifestJson: string;
  recordsPath: string;
  recordsJson: string;
  root: string;
}

/**
 * The page's prose, from the registrations, with no browser anywhere.
 *
 * One function behind both the check and the write, for the same reason the
 * check calls the generator's own `buildReadme` rather than describing a page
 * itself: two implementations of "what does this page say" drift, and the one
 * that drifts silently is the one nothing compares.
 */
function generatePage(options: PageCheckOptions): GeneratedPage {
  const pkg = resolveUplinkPackage(options.root ?? process.cwd());
  const inventory = readInventory(options.uplink);

  const scenes = buildScenes(pkg, inventory);
  assertEveryWidgetCovered(scenes, inventory);

  // Assets are the browser half's business, so the scene list is passed with no
  // rendered files behind it. That means the page's image blocks are compared as
  // the LINKS they are, and a link is written only for a picture that is on
  // disk: a fixture whose picture has not been drawn yet moves nothing here, and
  // whether the bytes behind a link are current is a question this cannot ask.
  const inputs = {
    pkg,
    inventory,
    scenes,
    assets: linkedAssets(scenes),
    assetDir: "docs/assets",
  };
  const { manifest } = buildManifest(inputs);
  const readme = buildReadme(inputs, manifest);
  const manifestPath = join(pkg.dir, "gonogo-uplink.json");

  return {
    readmePath: join(pkg.dir, "README.md"),
    readme,
    manifestPath,
    // `buildManifest` carries the committed integrity through when no bundle is named, which is what lets the writer below rewrite a released manifest without blanking the hash the release stamped into it.
    manifestJson: `${JSON.stringify(manifest, null, 2)}\n`,
    recordsPath: join(pkg.dir, WIDGET_RECORDS_FILE),
    recordsJson: widgetRecordsJson(widgetRecordsOf(inventory)),
    root: pkg.dir,
  };
}

/**
 * Regenerates the Uplink's README, manifest and `docs/widgets.json` and
 * compares them with the committed files, without writing anything.
 *
 * @category Page check
 * @categoryDescription Page check
 * Keeping an Uplink's generated page current: regenerate it and compare it with
 * what is committed, or write it, from a test or the command line.
 */
export function checkUplinkPage(
  options: PageCheckOptions = {},
): PageCheckResult {
  const page = generatePage(options);

  const differences: string[] = [];
  compare(
    page.readmePath,
    page.readme,
    (a, b) => a === b,
    page.root,
    differences,
  );
  compare(
    page.manifestPath,
    page.manifestJson,
    (a, b) => withoutIntegrity(a) === withoutIntegrity(b),
    page.root,
    differences,
  );
  compare(
    page.recordsPath,
    page.recordsJson,
    (a, b) => a === b,
    page.root,
    differences,
  );
  return { differences };
}

/**
 * Rewrites the Uplink's README, manifest and `docs/widgets.json` in place,
 * leaving `docs/assets` untouched: the counterpart to {@link checkUplinkPage},
 * for a change that moves the page's text but not its pictures, such as a new
 * contract version.
 * It needs no browser and writes the same bytes on any machine, where
 * `uplink-tools docs` would re-render every picture.
 *
 * @category Page check
 */
export function writeUplinkPage(options: PageCheckOptions = {}): {
  written: string[];
} {
  const page = generatePage(options);
  const written: string[] = [];
  for (const [file, content] of [
    [page.readmePath, page.readme],
    [page.manifestPath, page.manifestJson],
    [page.recordsPath, page.recordsJson],
  ] as const) {
    let committed: string | undefined;
    try {
      committed = readFileSync(file, "utf8");
    } catch {
      committed = undefined;
    }
    if (committed === content) continue;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, "utf8");
    written.push(display(page.root, file));
  }
  return { written };
}

function compare(
  file: string,
  expected: string,
  equal: (committed: string, generated: string) => boolean,
  root: string,
  out: string[],
): void {
  let committed: string;
  try {
    committed = readFileSync(file, "utf8");
  } catch {
    out.push(`${display(root, file)} does not exist`);
    return;
  }
  if (equal(committed, expected)) return;
  const committedLines = committed.split("\n");
  const expectedLines = expected.split("\n");
  const at = committedLines.findIndex((line, i) => line !== expectedLines[i]);
  out.push(
    `${display(root, file)} differs at line ${at + 1}:\n` +
      `      committed: ${JSON.stringify(committedLines[at] ?? "(end of file)")}\n` +
      `      generated: ${JSON.stringify(expectedLines[at] ?? "(end of file)")}`,
  );
}

/**
 * Import every module this Uplink's `gonogo.renderWith` names, so the scenes
 * that draw inside a host widget can find it.
 *
 * The renderer bundles that list into its page; a test has no bundler, so it
 * imports them through this, from the declaration rather than a path written
 * into the test.
 *
 * Await it before {@link expectUplinkPageCurrent} in an Uplink whose fixtures
 * name `_scene.hostWidget`. It is a no-op for one that declares no hosts.
 *
 * @category Page check
 */
export async function loadHostWidgets(
  options: PageCheckOptions = {},
): Promise<void> {
  const dir = options.root ?? process.cwd();
  const pkg = resolveUplinkPackage(dir);
  for (const host of pkg.renderWith) {
    // Through `renderModuleUrl`, the same resolver the render path and `--with`
    // use, because `renderWith` carries two shapes and this is the only
    // consumer that has to turn the second one back into a file itself. It was
    // a bare `pathToFileURL`, which is correct for a path and produces the
    // client directory with the package name glued onto the end for a
    // specifier.
    await import(/* @vite-ignore */ renderModuleUrl(dir, host));
  }
}

/**
 * The environment variable that makes {@link expectUplinkPageCurrent} rewrite
 * the page and manifest instead of failing, as updating a snapshot does. Set it
 * to `1`. On CI (with `CI` set) it is refused with an error, so a check run
 * can never heal itself.
 *
 * @category Page check
 */
export const PAGE_UPDATE_ENV = "GONOGO_UPLINK_PAGE_UPDATE";

/**
 * A gate that rewrites the thing it is measuring reports success no matter what
 * the tree says, so the switch is refused where nobody is reading the output.
 * CI healing itself and printing green is the failure this repo has already
 * paid for twice.
 */
function updateRequested(): boolean {
  // `uplink-tools page` asking for the page by name, which is a write and not a check healing itself.
  if (process.env[PAGE_WRITE_ENV] === "1") return true;
  if (process.env[PAGE_UPDATE_ENV] !== "1") return false;
  if (process.env.CI) {
    throw new Error(
      `${PAGE_UPDATE_ENV}=1 is set in CI, where regenerating the page would ` +
        "make this gate pass on any tree and commit nothing. Unset it: the " +
        "page is regenerated locally and pushed, never healed by the run that " +
        "was supposed to check it.",
    );
  }
  return true;
}

/**
 * Fails when the Uplink's committed README, manifest or `docs/widgets.json` no
 * longer matches what its registrations declare, listing each difference. For an Uplink's own test
 * suite: it needs no browser, and it cannot tell whether the committed images
 * are current, which `uplink-tools docs --check` does. With `PAGE_UPDATE_ENV`
 * set to `1` it rewrites the files instead of failing; on CI that is refused.
 *
 * @example
 * ```ts
 * import { expectUplinkPageCurrent } from "@ksp-gonogo/uplink-tools/page-check";
 * import "../index"; // the client, so its registrations run
 *
 * it("the generated page still describes this Uplink", () => {
 *   expectUplinkPageCurrent();
 * });
 * ```
 *
 * @category Page check
 */
export function expectUplinkPageCurrent(options: PageCheckOptions = {}): void {
  const { differences } = checkUplinkPage(options);
  if (differences.length === 0) return;
  if (updateRequested()) {
    const { written } = writeUplinkPage(options);
    console.info(`rewrote ${written.join(", ")}`);
    return;
  }
  throw new Error(
    `The generated Uplink page no longer matches the code: ` +
      `${differences.length} difference(s).\n  ${differences.join("\n  ")}\n\n` +
      `Regenerate the prose in place, with no browser and no change under ` +
      `docs/assets:\n` +
      `      npx uplink-tools page\n` +
      "  (inside the gonogo repository, `pnpm uplink-pages` does that for every Uplink).\n\n" +
      "  `uplink-tools docs` also fixes it, and re-renders every picture " +
      "through this machine's\n  rasteriser on the way past. Pictures are " +
      "regenerated on Linux and committed from there;\n  a local render of them is " +
      "the same mistake as a locally-rendered visual baseline.",
  );
}
