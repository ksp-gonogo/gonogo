import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readInventory } from "@ksp-gonogo/ui-kit/render-probe";
import { display, resolveUplinkPackage } from "./render/context";
import { buildManifest, buildReadme } from "./render/docs";
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
 * import { expectUplinkPageCurrent } from "@ksp-gonogo/ui-kit/page-check";
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
  const parsed = JSON.parse(json) as Record<string, unknown>;
  delete parsed.integrity;
  return JSON.stringify(parsed, null, 2);
}

export function checkUplinkPage(
  options: PageCheckOptions = {},
): PageCheckResult {
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
    assets: scenes.flatMap((scene) =>
      scene.modes.map((mode) => ({
        scene,
        mode: mode.name,
        file:
          scene.steps && scene.steps.length > 0
            ? `${scene.name}--${mode.name}.gif`
            : `${scene.name}--${mode.name}.png`,
        kind: (scene.steps && scene.steps.length > 0 ? "motion" : "still") as
          | "motion"
          | "still",
      })),
    ),
    assetDir: "docs/assets",
  };
  const { manifest } = buildManifest(inputs);
  const readme = buildReadme(inputs, manifest);

  const differences: string[] = [];
  compare(
    join(pkg.dir, "README.md"),
    readme,
    (a, b) => a === b,
    pkg.dir,
    differences,
  );
  compare(
    join(pkg.dir, "gonogo-uplink.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    (a, b) => withoutIntegrity(a) === withoutIntegrity(b),
    pkg.dir,
    differences,
  );
  return { differences };
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

/** {@link checkUplinkPage}, throwing the differences. For a test body. */
export function expectUplinkPageCurrent(options: PageCheckOptions = {}): void {
  const { differences } = checkUplinkPage(options);
  if (differences.length === 0) return;
  throw new Error(
    `The generated Uplink page no longer matches the code: ` +
      `${differences.length} difference(s).\n  ${differences.join("\n  ")}\n\n` +
      "Run `gonogo-uplink docs` and commit the result.",
  );
}
