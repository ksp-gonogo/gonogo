import type * as TS from "typescript";
import type { TypeScript } from "./program";

export type Resolution =
  | { ok: true; ids: string[]; families: string[] }
  | { ok: false; reason: string };

/** Most call sites followed from a parameter back to a value. */
export const CALL_SITE_DEPTH = 3;

/** A union wider than this is a declared type, not a statement of what is read. */
const MAX_UNION = 50;

/** One placeholder per whole dot-separated segment, and nothing else in a segment that has one. */
export function isValidFamily(pattern: string): boolean {
  let placeholders = 0;
  for (const segment of pattern.split(".")) {
    if (segment === "") return false;
    if (!/[<>]/.test(segment)) continue;
    if (!/^<[A-Za-z_][A-Za-z0-9_]*>$/.test(segment)) return false;
    placeholders++;
  }
  return placeholders > 0;
}

export interface Resolver {
  /** The Topic ids and family patterns `expr` can be, or why it cannot be known. */
  resolve(expr: TS.Expression): Resolution;
  /** Every call to the function `decl`, anywhere in the program's own source. */
  callSites(decl: TS.Node): readonly TS.CallExpression[];
  /** The declaration an identifier or property name refers to, aliases followed. */
  declarationOf(node: TS.Node): TS.Declaration | undefined;
}

/**
 * Resolution in the order a reader would try it, first hit wins: a literal, a
 * type that is a union of literals, a template or concatenation (which becomes
 * a family), a constant, a function parameter (followed to its call sites), and
 * otherwise nothing. An expression that is none of these is reported, never
 * guessed.
 */
export function createResolver(
  ts: TypeScript,
  program: TS.Program,
  isOwnSource: (file: TS.SourceFile) => boolean,
): Resolver {
  const checker = program.getTypeChecker();
  let sites: Map<TS.Node, TS.CallExpression[]> | undefined;

  const declarationOf: Resolver["declarationOf"] = (node) => {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
      symbol = checker.getAliasedSymbol(symbol);
    }
    return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  };

  const callSites: Resolver["callSites"] = (decl) => {
    if (!sites) {
      const index = new Map<TS.Node, TS.CallExpression[]>();
      sites = index;
      for (const file of program.getSourceFiles()) {
        if (!isOwnSource(file)) continue;
        const visit = (node: TS.Node) => {
          if (ts.isCallExpression(node)) {
            const found = declarationOf(node.expression);
            const target =
              found && ts.isVariableDeclaration(found) && found.initializer
                ? found.initializer
                : found;
            if (target) index.set(target, [...(index.get(target) ?? []), node]);
          }
          ts.forEachChild(node, visit);
        };
        visit(file);
      }
    }
    return sites.get(decl) ?? [];
  };

  const unwrap = (expr: TS.Expression): TS.Expression => {
    let node = expr;
    while (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node)
    ) {
      node = node.expression;
    }
    return node;
  };

  /** The literals a type is, when it is a small union of string literals. */
  const literalsOf = (type: TS.Type): string[] | undefined => {
    const members = type.isUnion() ? type.types : [type];
    if (members.length > MAX_UNION) return undefined;
    const out: string[] = [];
    for (const member of members) {
      if (!member.isStringLiteral()) return undefined;
      out.push(member.value);
    }
    return out;
  };

  const nameOf = (expr: TS.Expression): string | undefined => {
    const node = unwrap(expr);
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    return undefined;
  };

  /** The text and expressions of a template or a `+` chain, in order. */
  const piecesOf = (
    expr: TS.Expression,
  ): (string | TS.Expression)[] | undefined => {
    const node = unwrap(expr);
    if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)) {
      return [node.text];
    }
    if (ts.isTemplateExpression(node)) {
      const out: (string | TS.Expression)[] = [node.head.text];
      for (const span of node.templateSpans) {
        out.push(span.expression, span.literal.text);
      }
      return out;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      return [
        ...(piecesOf(node.left) ?? [node.left]),
        ...(piecesOf(node.right) ?? [node.right]),
      ];
    }
    return undefined;
  };

  const resolve: Resolver["resolve"] = (expr) => {
    const active = new Set<TS.Node>();

    const go = (
      node: TS.Expression,
      level: number,
      followParams: boolean,
    ): Resolution => {
      const inner = unwrap(node);
      if (
        ts.isStringLiteral(inner) ||
        ts.isNoSubstitutionTemplateLiteral(inner)
      ) {
        return { ok: true, ids: [inner.text], families: [] };
      }
      const literals = literalsOf(checker.getTypeAtLocation(inner));
      if (literals) return { ok: true, ids: literals, families: [] };

      const pieces = piecesOf(inner);
      if (pieces && pieces.length > 1) {
        let combos = [""];
        let placeholder = false;
        for (const piece of pieces) {
          if (typeof piece === "string") {
            combos = combos.map((c) => c + piece);
            continue;
          }
          const exact = go(piece, level, false);
          if (exact.ok && exact.families.length === 0) {
            combos = combos.flatMap((c) => exact.ids.map((id) => c + id));
            if (combos.length > MAX_UNION) {
              return {
                ok: false,
                reason: "the expression has too many possible values to list",
              };
            }
            continue;
          }
          const name = nameOf(piece);
          if (!name) {
            return {
              ok: false,
              reason:
                "a substitution has no name to stand for it in a family pattern",
            };
          }
          placeholder = true;
          combos = combos.map((c) => `${c}<${name}>`);
        }
        if (!placeholder) return { ok: true, ids: combos, families: [] };
        const bad = combos.find((c) => !isValidFamily(c));
        if (bad !== undefined) {
          return {
            ok: false,
            reason: `"${bad}" is not a family pattern: a substitution must fill a whole dot-separated segment`,
          };
        }
        return { ok: true, ids: [], families: combos };
      }

      if (!ts.isIdentifier(inner)) {
        return {
          ok: false,
          reason: `a ${ts.SyntaxKind[inner.kind]} is not a value the scanner can evaluate`,
        };
      }
      const decl = declarationOf(inner);
      if (!decl) {
        return {
          ok: false,
          reason: "the identifier does not resolve to a declaration",
        };
      }
      if (active.has(decl)) {
        return { ok: false, reason: "the value refers to itself" };
      }
      active.add(decl);
      try {
        if (
          ts.isVariableDeclaration(decl) &&
          decl.initializer &&
          ts.isVariableDeclarationList(decl.parent) &&
          decl.parent.flags & ts.NodeFlags.Const
        ) {
          return go(decl.initializer, level, followParams);
        }
        if (ts.isParameter(decl) && followParams) {
          if (!ts.isIdentifier(decl.name)) {
            return { ok: false, reason: "the parameter is destructured" };
          }
          if (level >= CALL_SITE_DEPTH) {
            return {
              ok: false,
              reason: `the value passes through more than ${CALL_SITE_DEPTH} call sites`,
            };
          }
          const fn = decl.parent;
          const index = fn.parameters.indexOf(decl);
          const calls = callSites(fn);
          if (calls.length === 0) {
            return {
              ok: false,
              reason: "the parameter is never passed a value in this program",
            };
          }
          const ids = new Set<string>();
          const families = new Set<string>();
          for (const call of calls) {
            const source = call.arguments[index] ?? decl.initializer;
            if (!source) {
              return {
                ok: false,
                reason: "a call passes the parameter nothing",
              };
            }
            const got = go(source, level + 1, true);
            if (!got.ok) return got;
            for (const id of got.ids) ids.add(id);
            for (const family of got.families) families.add(family);
          }
          return { ok: true, ids: [...ids], families: [...families] };
        }
        return {
          ok: false,
          reason: "the identifier is not a constant or a parameter",
        };
      } finally {
        active.delete(decl);
      }
    };

    return go(expr, 0, true);
  };

  return { resolve, callSites, declarationOf };
}
