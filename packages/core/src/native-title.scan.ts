import { join } from "node:path";
import ts from "typescript";
import { modTsRoots } from "./unknown-cast.scan";

/**
 * Finds a native `title` attribute used as a tooltip.
 *
 * The browser draws it unstyled, after a delay no theme can shorten, and only
 * for a pointer: a keyboard user never sees it and a touch user cannot reach
 * it. The kit's `Tooltip` is themed, opens on focus as well as hover, closes on
 * Escape and is announced as the element's description.
 *
 * WHY THE COMPILER AND NOT A REGEX. `title` is also a prop of `Panel`, `Section`,
 * `Card` and `Notice`, where it is a heading and never a tooltip, and the two
 * spell identically. Only the type of the property says which one a JSX
 * attribute is: it is a tooltip when its declaration is React's own
 * `HTMLAttributes.title`, whether the tag is an intrinsic element, a styled
 * component or a kit component that forwards its attributes to the DOM.
 *
 * An `iframe` is exempt: its `title` is the frame's accessible name, which
 * nothing else supplies.
 */

/** Roots whose JSX draws operator-facing UI. */
export const TITLE_SCAN_PACKAGE_ROOTS = [
  "packages/app",
  "packages/components",
  "packages/serial",
  "packages/ui",
  "packages/ui-kit",
] as const;

/** Tags whose `title` is an accessible name rather than a tooltip. */
const NAME_NOT_TIP = new Set(["iframe"]);

/** One `title` attribute that the browser would draw as a tooltip. */
export interface TitleSite {
  /** Repo-relative, POSIX separators. */
  file: string;
  /** One-based. */
  line: number;
  /** The tag the attribute sits on. */
  tag: string;
}

export interface TitleScan {
  root: string;
  files: number;
  /** `title` attributes seen at all, tooltip or heading prop alike. */
  titles: number;
  /** Attributes whose property the compiler could not resolve. */
  unresolved: number;
  sites: TitleSite[];
}

export function titleScanRoots(repoRoot: string): string[] {
  return [...TITLE_SCAN_PACKAGE_ROOTS, ...modTsRoots(repoRoot)];
}

/** Test and story files assert on the DOM or demonstrate it; neither ships. */
function isShipped(fileName: string): boolean {
  return !/\.(test|test-d|stories|story)\.tsx?$/.test(fileName);
}

/** Whether a symbol is React's own `title`, the one the browser turns into a tooltip. */
function isNativeTitle(symbol: ts.Symbol): boolean {
  return (symbol.declarations ?? []).some((decl) => {
    if (!decl.getSourceFile().fileName.includes("/@types/react/")) return false;
    const owner = decl.parent;
    return (
      ts.isInterfaceDeclaration(owner) &&
      /HTMLAttributes$/.test(owner.name.text)
    );
  });
}

export function scanProgramForTitles(
  program: ts.Program,
  repoRoot: string,
  root: string,
  absPrefix: string,
): TitleScan {
  const checker = program.getTypeChecker();
  const scan: TitleScan = {
    root,
    files: 0,
    titles: 0,
    unresolved: 0,
    sites: [],
  };

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    if (!sf.fileName.startsWith(absPrefix)) continue;
    if (sf.fileName.includes("/node_modules/")) continue;
    if (!isShipped(sf.fileName)) continue;
    scan.files += 1;

    const visit = (node: ts.Node): void => {
      if (
        ts.isJsxAttribute(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "title"
      ) {
        scan.titles += 1;
        const opening = node.parent.parent;
        const tag = opening.tagName.getText();
        // The attribute's own symbol is its declaration here; the property it fills is on the props type.
        const props = checker.getContextualType(node.parent);
        const symbol = props?.getProperty("title");
        if (!symbol) scan.unresolved += 1;
        if (symbol && isNativeTitle(symbol) && !NAME_NOT_TIP.has(tag)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
          scan.sites.push({
            file: sf.fileName.slice(repoRoot.length + 1),
            line: line + 1,
            tag,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  scan.sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return scan;
}

/** Build the root's own program from its own `tsconfig.json`. */
export function scanTitleRoot(repoRoot: string, root: string): TitleScan {
  const configPath = join(repoRoot, root, "tsconfig.json");
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => {},
  } as ts.ParseConfigFileHost);
  if (!parsed) {
    throw new Error(
      `[native-title] ${root}/tsconfig.json would not parse, so nothing in ` +
        "that root was scanned.",
    );
  }
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: { ...parsed.options, noEmit: true },
  });
  return scanProgramForTitles(
    program,
    repoRoot,
    root,
    `${join(repoRoot, root)}/`,
  );
}

/** Scan a directory of hand-written files as its own root. */
export function scanTitleScratchDir(
  dir: string,
  fileNames: string[],
): TitleScan {
  const program = ts.createProgram({
    rootNames: fileNames,
    options: {
      strict: true,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      skipLibCheck: true,
      noEmit: true,
    },
  });
  return scanProgramForTitles(program, dir, "", `${dir}/`);
}
