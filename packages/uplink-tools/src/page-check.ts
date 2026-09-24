import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readInventory } from "@ksp-gonogo/uplink-tools/render-probe";
import {
  display,
  renderModuleUrl,
  resolveUplinkPackage,
} from "./render/context";
import { buildManifest, buildReadme, linkedAssets } from "./render/docs";
import { assertEveryWidgetCovered, buildScenes } from "./render/scenes";

/**
 * The browserless half of the page gate, for an Uplink's own test suite.
 *
 * `gonogo-uplink docs --check` does two jobs at once. Asking whether the
 * committed PNGs are current means rendering them, so it needs Chromium. Asking
 * whether the PROSE still matches what the registrations declare does not need a
 * browser at all: the facts come from a registry read, and an Uplink's test suite
 * has already loaded its own client under jsdom with a host installed. Fusing the
 * two made the cheap question cost as much as the expensive one, and put the
 * whole gate out of reach of any author whose CI has no Playwright. A gate an
 * author cannot run is a gate that rots.
 *
 * So this is the same check minus the pictures, callable from a test:
 *
 * ```ts
 * import { expectUplinkPageCurrent } from "@ksp-gonogo/uplink-tools/page-check";
 * import "../index";  // the client, so its registrations happen
 *
 * it("the generated page still describes this Uplink", () => {
 *   expectUplinkPageCurrent();
 * });
 * ```
 *
 * ONE read, not two. It calls the same `readInventory` the renderer calls and
 * the same `buildReadme` the generator calls, so this cannot start describing a
 * different Uplink from the one the pictures are of. A second implementation of
 * "what does this Uplink add" would be the drift this whole tool exists against.
 *
 * What it deliberately cannot see: whether the committed images are current, and
 * whether any of them is a render of nothing. Both need a browser, and both stay
 * with `docs --check`.
 *
 * The same read also WRITES, through {@link writeUplinkPage}: a generated file
 * whose only remedy costs a browser and a rasteriser is one people fix by
 * editing it by hand or by committing 170 re-rendered pictures, and both have
 * happened here.
 */

export interface PageCheckOptions {
  /** The Uplink client package. Defaults to the working directory. */
  root?: string;
  /** Which declared client, when the bundle carries several. */
  uplink?: string;
}

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
    throw new Error("gonogo-uplink: the manifest does not hold a JSON object.");
  }
  const manifest: Record<string, unknown> = parsed as Record<string, unknown>;
  delete manifest.integrity;
  return JSON.stringify(manifest, null, 2);
}

/** The two prose files of a page, and where they belong. */
interface GeneratedPage {
  readmePath: string;
  readme: string;
  manifestPath: string;
  manifestJson: string;
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
  // the LINKS they are: a fixture added or removed still moves the markdown, and
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
    // The one field generated here is always empty, because a working copy has
    // no distributed file to hash. Carrying the committed value through is what
    // lets the writer below rewrite a released manifest without blanking the
    // hash the release stamped into it.
    manifestJson: `${JSON.stringify({ ...manifest, integrity: committedIntegrity(manifestPath) }, null, 2)}\n`,
    root: pkg.dir,
  };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The `integrity` a committed manifest already carries, or the empty claim. */
function committedIntegrity(manifestPath: string): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (isJsonObject(parsed) && typeof parsed.integrity === "string") {
      return parsed.integrity;
    }
  } catch {
    // No manifest yet, or one nothing can parse. Either way there is no hash to
    // preserve, and the caller is about to write a whole new file over it.
  }
  return "";
}

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
  return { differences };
}

/**
 * Rewrite the page's prose in place, leaving `docs/assets` untouched.
 *
 * The counterpart to {@link checkUplinkPage}, and the reason it exists is the
 * cost of the alternative. `gonogo-uplink docs` is the only other way to move
 * these two files, and it re-rasterises every picture on the way past: on a
 * developer's machine that produces a diff of 170 PNGs nobody asked for, of the
 * same kind as a locally-rendered visual baseline, for a change that moved one
 * line of markdown. An additive contract bump is exactly that change, and it
 * moves the "Built against" row of every bundled Uplink at once.
 *
 * So the prose has a writer of its own, on the same registry read the check
 * uses. It needs no browser, produces the same bytes on any operating system,
 * and cannot touch an asset because it never renders one.
 */
export function writeUplinkPage(options: PageCheckOptions = {}): {
  written: string[];
} {
  const page = generatePage(options);
  const written: string[] = [];
  for (const [file, content] of [
    [page.readmePath, page.readme],
    [page.manifestPath, page.manifestJson],
  ] as const) {
    let committed: string | undefined;
    try {
      committed = readFileSync(file, "utf8");
    } catch {
      committed = undefined;
    }
    if (committed === content) continue;
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
 * The renderer bundles that list into its browser entry; a test has no bundler,
 * so it has to import them itself. Through the DECLARATION rather than by
 * writing the path into the test, for the reason the declaration exists: a host
 * widget ships with the app, in a package no Uplink may name, and a relative
 * path climbing out of the client would leave the package unextractable (the
 * extraction probe typechecks `src` outside the workspace, where that path does
 * not exist). A runtime import of a resolved path is invisible to that
 * typecheck and to the isolation ratchet's specifier denylist alike, which is
 * the same latitude `renderWith` already takes.
 *
 * Await it before {@link expectUplinkPageCurrent} in an Uplink whose fixtures
 * name `_scene.hostWidget`. It is a no-op for one that declares no hosts.
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
 * The environment variable that turns this gate into its own fix.
 *
 * The same affordance a snapshot assertion has, and for the same reason: the
 * expected value is GENERATED, so the person who broke it is never being asked
 * to write anything, only to re-derive it. The difference from a snapshot is
 * that the derivation is cheap and exact, so there is nothing to review in the
 * result beyond the diff itself.
 */
export const PAGE_UPDATE_ENV = "GONOGO_UPLINK_PAGE_UPDATE";

/**
 * A gate that rewrites the thing it is measuring reports success no matter what
 * the tree says, so the switch is refused where nobody is reading the output.
 * CI healing itself and printing green is the failure this repo has already
 * paid for twice.
 */
function updateRequested(): boolean {
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

/** {@link checkUplinkPage}, throwing the differences. For a test body. */
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
      `      pnpm uplink-pages\n` +
      `  or, for this Uplink alone, re-run its suite with ${PAGE_UPDATE_ENV}=1.\n\n` +
      "  `gonogo-uplink docs` also fixes it, and re-renders every picture " +
      "through this machine's\n  rasteriser on the way past. The pictures are " +
      "regenerated on Linux by `uplink-docs.yml`;\n  a local render of them is " +
      "the same mistake as a locally-rendered visual baseline.",
  );
}
