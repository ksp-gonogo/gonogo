import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type * as TS from "typescript";
import { CheckUnableError, type TypeScript } from "../../program";
import type { CheckContext, FixableFinding, Rule } from "../../types";

/** The member of a command handle that sends with no kit input drawing it. */
export const SEND_WITHOUT_INPUT = "dangerouslySendWithoutInput";

export const SEND_WITHOUT_INPUT_MESSAGE = `${SEND_WITHOUT_INPUT}: nothing on screen shows the operator this send.`;

export const SEND_WITHOUT_INPUT_FIX =
  "If a control sends it, pass the command to that control: command={handle.with(args)}. A send no control starts can stay.";

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const TEST_DIR = /[\\/](?:test|tests|__tests__)[\\/]/;
const SKIPPED_DIRS = new Set(["node_modules", "dist", "__generated__"]);

function loadTypeScriptSync(clientDir: string): TypeScript {
  for (const from of [
    join(clientDir, "package.json"),
    fileURLToPath(import.meta.url),
  ]) {
    try {
      const loaded: { default?: TypeScript } & TypeScript =
        createRequire(from)("typescript");
      return loaded.default ?? loaded;
    } catch {
      // Not installed there: try the next place.
    }
  }
  throw new CheckUnableError(
    "typescript is not installed where the client can reach it. check reads the client with the TypeScript compiler:\n  npm i -D typescript",
  );
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) found.push(...sourceFiles(path));
      continue;
    }
    if (
      SOURCE.test(entry.name) &&
      !entry.name.endsWith(".d.ts") &&
      !TEST_FILE.test(entry.name) &&
      !TEST_DIR.test(path)
    ) {
      found.push(path);
    }
  }
  return found.sort();
}

/** The 1-based lines of a source text that name the send, by identifier or by `["..."]` access. */
export function sendReadLines(
  ts: TypeScript,
  source: string,
  path: string,
): number[] {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines: number[] = [];
  const visit = (node: TS.Node): void => {
    const named =
      (ts.isIdentifier(node) && node.text === SEND_WITHOUT_INPUT) ||
      (ts.isStringLiteral(node) &&
        node.text === SEND_WITHOUT_INPUT &&
        ts.isElementAccessExpression(node.parent));
    if (named) {
      const parent = node.parent;
      const declaresMember =
        (ts.isPropertySignature(parent) || ts.isMethodSignature(parent)) &&
        parent.name === node;
      if (!declaresMember && !ts.isIndexedAccessTypeNode(parent)) {
        lines.push(
          file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return lines;
}

/**
 * A warning for every place the client sends a command with no kit input
 * drawing it. It is a warning and never an error: a send that no control
 * starts is legitimate, and `--skip commands` turns the rule off.
 */
export const sendWithoutInputRule: Rule = {
  id: "commands/send-without-input",
  group: "commands",
  check({ clientDir }: CheckContext): FixableFinding[] {
    const ts = loadTypeScriptSync(clientDir);
    const out: FixableFinding[] = [];
    for (const file of sourceFiles(join(clientDir, "src"))) {
      const source = readFileSync(file, "utf8");
      if (!source.includes(SEND_WITHOUT_INPUT)) continue;
      for (const line of sendReadLines(ts, source, file)) {
        out.push({
          rule: "commands/send-without-input",
          severity: "warning",
          file,
          line,
          message: SEND_WITHOUT_INPUT_MESSAGE,
          fixable: false,
          fix: SEND_WITHOUT_INPUT_FIX,
        });
      }
    }
    return out;
  },
};

export const commandRules: readonly Rule[] = [sendWithoutInputRule];
