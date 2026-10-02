// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  scanTitleRoot,
  scanTitleScratchDir,
  titleScanRoots,
} from "./native-title.scan";
import { rootsInScope } from "./scanScope";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const CORE_ROOT = join(HERE, "..");

const ROOTS = rootsInScope(titleScanRoots(REPO_ROOT));
const SCANS = ROOTS.map((root) => scanTitleRoot(REPO_ROOT, root));

/**
 * Plants live beside core's `node_modules`, so `react` resolves from them, and
 * are removed as soon as they are read.
 */
function plant(files: Record<string, string>) {
  const parent = join(CORE_ROOT, ".native-title-plants");
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, "p-"));
  const names = Object.entries(files).map(([name, text]) => {
    const path = join(dir, name);
    writeFileSync(path, text);
    return path;
  });
  try {
    return scanTitleScratchDir(dir, names);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    try {
      rmdirSync(parent);
    } catch {
      // Another worker's plant still lives there.
    }
  }
}

describe("design-system: a tooltip is the kit's Tooltip, never the native title attribute", () => {
  it("catches a native title in every spelling of the element it sits on", () => {
    const scan = plant({
      "a.tsx": `
        import styled from "styled-components";
        const Styled = styled.span\`color: red;\`;
        function Forwards(props: React.HTMLAttributes<HTMLElement>) {
          return <span {...props} />;
        }
        export const A = () => (
          <>
            <button type="button" title="intrinsic">x</button>
            <Styled title="styled">x</Styled>
            <Forwards title="forwarding component">x</Forwards>
          </>
        );
      `,
    });
    expect(scan.sites.map((s) => s.tag).sort()).toEqual([
      "Forwards",
      "Styled",
      "button",
    ]);
  });

  it("leaves a component's own title prop and an iframe's name alone", () => {
    const scan = plant({
      "b.tsx": `
        function Panel(props: { title: string }) {
          return <h3>{props.title}</h3>;
        }
        export const B = () => (
          <>
            <Panel title="a heading, not a tooltip" />
            <iframe title="the frame's accessible name" />
          </>
        );
      `,
    });
    expect(scan.titles).toBe(2);
    expect(scan.sites).toEqual([]);
  });

  it("does not scan test files, which assert on the DOM", () => {
    const scan = plant({
      "c.test.tsx": `export const C = () => <span title="asserted on">x</span>;`,
    });
    expect(scan.files).toBe(0);
    expect(scan.sites).toEqual([]);
  });

  it("walked the roots it thinks it walked, and resolved every title it saw", () => {
    for (const scan of SCANS) {
      expect(scan.unresolved, `${scan.root}: unresolved titles`).toBe(0);
    }
    const total = (key: "files" | "titles") =>
      SCANS.reduce((sum, s) => sum + s[key], 0);
    if (ROOTS.length === titleScanRoots(REPO_ROOT).length) {
      expect(total("files")).toBeGreaterThan(1000);
      expect(total("titles")).toBeGreaterThan(20);
    }
  });

  it("finds no native title used as a tooltip in widget or kit code", () => {
    const sites = SCANS.flatMap((s) => s.sites);
    expect(
      sites.map((s) => `${s.file}:${s.line} <${s.tag} title>`),
      "wrap the element in the kit's <Tooltip text=...> (keep an aria-label where the title was the accessible name)",
    ).toEqual([]);
  }, 120_000);
});
