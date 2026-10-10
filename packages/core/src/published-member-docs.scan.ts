import { dirname, join, relative, sep } from "node:path";
import ts from "typescript";
import {
  compilerOptions,
  type EntryPoint,
  publishedEntryPoints,
} from "./published-entry-points";

/**
 * The scan behind `styleguide-published-member-docs.test.ts`: every member of
 * an exported interface, object-typed alias or class that carries no doc
 * comment of its own.
 *
 * The reference page prints each type's members in a table, and a member with
 * no comment leaves its description cell empty. Only the members a type
 * declares itself are graded: an inherited one belongs to the type that
 * declares it, and a type declared by a third-party package is not ours to
 * document. A member tagged `@internal`, a private or protected class member
 * and a name beginning with an underscore are not on the page and are skipped.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

export interface MemberScan {
  /** Every entry point graded; empty means discovery failed. */
  entries: EntryPoint[];
  /** Undocumented members by package, as `subpath:Type#member`. */
  faults: Map<string, Set<string>>;
  /** Members graded, counted over every entry point. */
  graded: number;
}

/** The members a declaration lists, or none for a declaration that is not an object type. */
function membersOf(declaration: ts.Declaration): readonly ts.Node[] {
  if (ts.isInterfaceDeclaration(declaration)) return declaration.members;
  if (ts.isClassDeclaration(declaration)) {
    return declaration.members.filter(
      (member) =>
        !ts.getCombinedModifierFlags(member as ts.Declaration).valueOf() ||
        !(
          ts.getCombinedModifierFlags(member as ts.Declaration) &
          (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)
        ),
    );
  }
  if (ts.isTypeAliasDeclaration(declaration))
    return literalMembers(declaration.type);
  return [];
}

/** The members of every object literal an alias is built from, through unions, intersections and parentheses. */
function literalMembers(type: ts.TypeNode): readonly ts.Node[] {
  if (ts.isTypeLiteralNode(type)) return type.members;
  if (ts.isParenthesizedTypeNode(type)) return literalMembers(type.type);
  if (ts.isIntersectionTypeNode(type) || ts.isUnionTypeNode(type)) {
    return type.types.flatMap(literalMembers);
  }
  return [];
}

const NAMED = (node: ts.Node): node is ts.Node & { name: ts.PropertyName } =>
  (ts.isPropertySignature(node) ||
    ts.isMethodSignature(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node)) &&
  node.name !== undefined;

/** The undocumented members among what `entryFile` exports, by `Type#member`. */
export function memberFaultsOfEntry(
  program: ts.Program,
  entryFile: string,
  graded: Set<ts.Symbol>,
  declaredElsewhere: (file: string) => boolean,
): { faults: string[]; count: number } {
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(entryFile);
  if (!sf) throw new Error(`the program has no ${entryFile}`);
  const moduleSymbol = checker.getSymbolAtLocation(sf);
  if (!moduleSymbol) return { faults: [], count: 0 };
  const faults: string[] = [];
  let count = 0;
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const symbol =
      exported.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(exported)
        : exported;
    if (graded.has(symbol)) continue;
    graded.add(symbol);
    for (const declaration of symbol.declarations ?? []) {
      const file = declaration.getSourceFile().fileName;
      if (declaredElsewhere(file) || file.includes("/node_modules/")) continue;
      for (const member of membersOf(declaration)) {
        if (!NAMED(member)) continue;
        const name = member.name.getText();
        if (name.startsWith("_") || name.startsWith("[")) continue;
        const memberSymbol = checker.getSymbolAtLocation(member.name);
        if (!memberSymbol) continue;
        count += 1;
        const doc = ts
          .displayPartsToString(memberSymbol.getDocumentationComment(checker))
          .trim();
        const internal = memberSymbol
          .getJsDocTags(checker)
          .some((tag) => tag.name === "internal");
        if (doc === "" && !internal) faults.push(`${exported.name}#${name}`);
      }
    }
  }
  return { faults: [...new Set(faults)], count };
}

/** Grades every published entry point. */
export function scanPublishedMemberDocs(root = REPO_ROOT): MemberScan {
  const entries = publishedEntryPoints(root);
  const publishedDirs = [...new Set(entries.map((e) => e.dir))];
  const packageOf = (file: string): string | null => {
    const rel = relative(root, file).split(sep).join("/");
    return publishedDirs.find((dir) => rel.startsWith(`${dir}/`)) ?? null;
  };
  const faults = new Map<string, Set<string>>();
  let total = 0;
  for (const dir of publishedDirs) {
    const own = entries.filter((e) => e.dir === dir);
    const program = ts.createProgram(
      own.map((e) => join(root, dir, e.file)),
      compilerOptions(dir, root),
    );
    const graded = new Set<ts.Symbol>();
    const declaredElsewhere = (file: string) => {
      const owner = packageOf(file);
      return owner !== null && owner !== dir;
    };
    for (const entry of own) {
      const { faults: found, count } = memberFaultsOfEntry(
        program,
        join(root, dir, entry.file),
        graded,
        declaredElsewhere,
      );
      total += count;
      const keys = faults.get(entry.pkg) ?? new Set<string>();
      for (const fault of found) keys.add(`${entry.subpath}:${fault}`);
      faults.set(entry.pkg, keys);
    }
  }
  return { entries, faults, graded: total };
}

/**
 * A planted module, graded by the same function. `Plant#bare`,
 * `Shape#bare`, `Klass#bare` and `Klass#method` must fail; the documented,
 * `@internal`, private and underscored members must not.
 */
export function gradeMemberPlant(): string[] {
  const file = join(dirname(REPO_ROOT), "__member_docs_plant__.ts");
  const text = [
    "export interface Plant {",
    "  /** Documented. */",
    "  ok: number;",
    "  bare: number;",
    "  /** @internal */",
    "  hidden: number;",
    "  _underscored: number;",
    "}",
    "export type Shape = {",
    "  bare: string;",
    "  /** Documented. */",
    "  ok: string;",
    "};",
    "export class Klass {",
    "  bare = 1;",
    "  /** Documented. */",
    "  ok = 2;",
    "  private secret = 3;",
    "  method(): void {}",
    "}",
  ].join("\n");
  const host = ts.createCompilerHost({});
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version) =>
    name === file
      ? ts.createSourceFile(name, text, version)
      : getSourceFile(name, version);
  host.fileExists = (name) => name === file || ts.sys.fileExists(name);
  host.readFile = (name) => (name === file ? text : ts.sys.readFile(name));
  const program = ts.createProgram([file], { noEmit: true }, host);
  return memberFaultsOfEntry(program, file, new Set(), () => false).faults;
}

/** The debt list as `published-member-docs.debt.json` holds it: one sorted list per package. */
export function memberDebtJson(
  debt: Readonly<Record<string, readonly string[]>>,
): string {
  const sorted = Object.fromEntries(
    Object.keys(debt)
      .sort()
      .map((pkg) => [pkg, [...debt[pkg]].sort()]),
  );
  return `${JSON.stringify(sorted, null, 2)}\n`;
}
