// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  buttonTooltipHits,
  buttonTooltipVerdict,
  scanButtonTooltips,
  scopedSources,
} from "./button-tooltips.scan";

/**
 * The button tooltip rule, held at zero over the built-in widgets and the
 * bundled Uplinks' clients: a glyph-only button is named (the kit shows the name
 * as its tip), a disabled button says why, and a tip does not repeat the words
 * on the button it sits on. The kit's Button, IconButton and ToggleButton apply
 * the rule themselves; this holds the code that steps around them.
 *
 * The planted violations are source strings, run through the same parser and the
 * same file walk as the tree, so a scan that stopped seeing a rule fails here.
 */

const RESULT = scanButtonTooltips();

const plantDir = mkdtempSync(join(tmpdir(), "button-tooltips-plant-"));
afterAll(() => rmSync(plantDir, { recursive: true, force: true }));

const rules = (source: string, file = "planted.tsx") =>
  buttonTooltipHits(source, file).map((hit) => hit.rule);

describe("design-system: the button tooltip rule", () => {
  it("reads the widgets and the bundled Uplinks' clients", () => {
    console.info(
      `[button-tooltips] read ${RESULT.read.length} tracked source files`,
    );
    expect(RESULT.read.length).toBeGreaterThan(100);
    expect(RESULT.read.some((f) => f.startsWith("packages/components/"))).toBe(
      true,
    );
    expect(RESULT.read.some((f) => f.startsWith("mod/"))).toBe(true);
    expect(RESULT.read.some((f) => f.endsWith(".test.tsx"))).toBe(false);
  });

  it("reads every tracked widget source, by a second listing", () => {
    const listed = execFileSync(
      "git",
      ["ls-files", "--", "packages/components/src"],
      {
        cwd: join(import.meta.dirname, "..", "..", ".."),
        encoding: "utf8",
      },
    )
      .split("\n")
      .filter(
        (file) =>
          file.endsWith(".tsx") &&
          !/\.(test|stories|characterise)\.tsx$/.test(file) &&
          !file.includes("/__generated__/"),
      );
    expect(listed.length).toBeGreaterThan(50);
    const read = new Set(RESULT.read);
    for (const file of listed) expect(read, file).toContain(file);
  });

  it("finds no button that breaks the rule", () => {
    expect(buttonTooltipVerdict(RESULT)).toBeNull();
  });

  it("fails as BLIND when it reads no files", () => {
    expect(buttonTooltipVerdict(scanButtonTooltips([], plantDir))).toMatch(
      /^BLIND/,
    );
    expect(
      buttonTooltipVerdict(scanButtonTooltips(["missing.tsx"], plantDir)),
    ).toMatch(/^BLIND/);
    expect(scopedSources().length).toBeGreaterThan(0);
  });

  it("sees a button with no name", () => {
    expect(
      rules("const A = () => <IconButton><CloseIcon /></IconButton>;"),
    ).toEqual(["unnamed"]);
  });

  it("sees a glyph-only raw button with no tip of its own", () => {
    expect(
      rules(
        'const S = styled.button`x`;\nconst A = () => <S aria-label="Close"><CloseIcon /></S>;',
      ),
    ).toEqual(["untipped-icon"]);
    expect(
      rules(
        'const S = styled.button`x`;\nconst A = () => <Tooltip text="Close"><S aria-label="Close"><CloseIcon /></S></Tooltip>;',
      ),
    ).toEqual([]);
  });

  it("sees a disabled button with no reason, kit or raw", () => {
    expect(rules("const A = () => <Button disabled={x}>Fly</Button>;")).toEqual(
      ["disabled-without-reason"],
    );
    expect(
      rules(
        'const A = () => <Button disabled={x} disabledReason="No vessel">Fly</Button>;',
      ),
    ).toEqual([]);
    expect(rules("const A = () => <button disabled>Fly</button>;")).toEqual([
      "disabled-without-reason",
    ]);
    expect(
      rules("const A = () => <Button disabled={false}>Fly</Button>;"),
    ).toEqual([]);
  });

  it("sees a tip that only repeats the button's words", () => {
    expect(
      rules(
        'const A = () => <Tooltip text="Save"><Button>Save</Button></Tooltip>;',
      ),
    ).toEqual(["tip-repeats-label"]);
    expect(
      rules(
        'const A = () => <Tooltip text="Saves the game first"><Button>Save</Button></Tooltip>;',
      ),
    ).toEqual([]);
  });

  it("knows a styled button declared in another file, and a wrapper of a kit button", () => {
    writeFileSync(
      join(plantDir, "styles.tsx"),
      "export const StepBtn = styled.button`x`;\nexport function WarpButton(props) { return <Button {...props} />; }\n",
    );
    mkdirSync(join(plantDir, "w"), { recursive: true });
    writeFileSync(
      join(plantDir, "w", "view.tsx"),
      'const A = () => <><StepBtn aria-label="Up"><UpIcon /></StepBtn><WarpButton disabled>1x</WarpButton></>;',
    );
    const found = scanButtonTooltips(["styles.tsx", "w/view.tsx"], plantDir);
    expect(
      (found.hits.get("w/view.tsx") ?? []).map((hit) => hit.rule).sort(),
    ).toEqual(["disabled-without-reason", "untipped-icon"]);
    expect(buttonTooltipVerdict(found)).toContain("w/view.tsx");
  });

  it("parses rather than greps, and leaves a hidden or spread button alone", () => {
    expect(
      rules('const s = "<Button disabled>Fly</Button>"; // <IconButton />'),
    ).toEqual([]);
    expect(
      rules('const A = () => <Button disabled aria-hidden="true">x</Button>;'),
    ).toEqual([]);
    expect(
      rules("const A = (p) => <Button {...p} disabled>x</Button>;"),
    ).toEqual([]);
  });
});
