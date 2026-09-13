/**
 * Holds the hand-written `generated-fixture/` files to the shape the real
 * codegen emits.
 *
 * The fixture cannot BE generated here. Its source of truth is
 * `Sitrep.Contract.RtConfig` running inside rtcli, which reflects over a
 * compiled contract assembly, and the CI job that runs the guide check has no
 * dotnet. What this job does have is the output of that same generator for
 * every contract in the repo, committed under `__generated__/` and held
 * byte-current by the `mod` job's "Every generated artifact is in sync with its
 * source" step. So a generator change reaches those files on the commit that
 * makes it, and this gate carries it the last step to the fixture.
 *
 * That link was missing once. EmitCommandMap gained `GeneratedCommandRail` and
 * `GENERATED_COMMAND_RAIL`, the guide started importing the rail, the fixture
 * kept only the older three exports, and the guide check stayed red for many
 * commits naming a symbol rather than the stale copy that lacked it.
 *
 * What is compared is each file's exported SCHEMA, not its data: every export
 * name, its declaration kind, its type annotation and assertion chain, and the
 * identifier-keyed members of an interface. Quoted keys (command and Topic
 * ids) and literal values are a contract's own data and differ by design.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/**
 * A fixture file whose exports are the example contract's own types rather
 * than a fixed set the generator writes. Anything not listed here must have a
 * generated counterpart to be held against.
 */
const UNGATED = {
  "contract.ts":
    "rtcli emits one interface per wire type, so its exports are the example contract's own names",
};

const squash = (text) => text.replace(/\s+/g, " ").trim();

function isStringLiteralType(node) {
  return ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal);
}

/**
 * A type's text with literal data folded away, so a union of unit tokens reads
 * the same whichever tokens a contract happens to declare.
 */
function typeShape(node, sf) {
  if (!node) return "-";
  if (isStringLiteralType(node)) return "<string literals>";
  if (ts.isUnionTypeNode(node) && node.types.every(isStringLiteralType)) {
    return "<string literals>";
  }
  return squash(node.getText(sf));
}

function initialiserShape(node, sf) {
  if (!node) return "-";
  if (ts.isAsExpression(node)) {
    return `${initialiserShape(node.expression, sf)} as ${typeShape(node.type, sf)}`;
  }
  if (ts.isSatisfiesExpression(node)) {
    return `${initialiserShape(node.expression, sf)} satisfies ${typeShape(node.type, sf)}`;
  }
  if (ts.isObjectLiteralExpression(node)) return "{...}";
  if (ts.isArrayLiteralExpression(node)) return "[...]";
  return ts.SyntaxKind[node.kind];
}

function memberShape(member, sf) {
  if (ts.isPropertySignature(member)) {
    if (!ts.isIdentifier(member.name)) return null;
    const readonly = member.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.ReadonlyKeyword,
    )
      ? "readonly "
      : "";
    const optional = member.questionToken ? "?" : "";
    return `${readonly}${member.name.text}${optional}: ${typeShape(member.type, sf)}`;
  }
  return squash(member.getText(sf));
}

const isExported = (node) =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some(
    (m) => m.kind === ts.SyntaxKind.ExportKeyword,
  );

/** Every export of a module source, as name -> schema signature. */
export function exportShapes(source, fileName = "module.ts") {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const shapes = new Map();
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st) || ts.isExportAssignment(st)) {
      shapes.set(squash(st.getText(sf)), "re-export");
      continue;
    }
    if (!isExported(st)) continue;
    if (ts.isInterfaceDeclaration(st)) {
      const members = st.members
        .map((m) => memberShape(m, sf))
        .filter((m) => m !== null);
      shapes.set(st.name.text, `interface { ${members.join("; ")} }`);
    } else if (ts.isTypeAliasDeclaration(st)) {
      shapes.set(st.name.text, `type = ${typeShape(st.type, sf)}`);
    } else if (ts.isVariableStatement(st)) {
      const keyword =
        st.declarationList.flags & ts.NodeFlags.Const ? "const" : "let";
      for (const d of st.declarationList.declarations) {
        shapes.set(
          squash(d.name.getText(sf)),
          `${keyword}: ${typeShape(d.type, sf)} = ${initialiserShape(d.initializer, sf)}`,
        );
      }
    } else {
      const name = st.name ? st.name.getText(sf) : squash(st.getText(sf));
      shapes.set(name, ts.SyntaxKind[st.kind]);
    }
  }
  return shapes;
}

/** Human-readable differences between two shape maps; empty when they agree. */
export function compareShapes(expected, actual) {
  const out = [];
  for (const [name, shape] of expected) {
    if (!actual.has(name)) out.push(`missing export ${name} (${shape})`);
    else if (actual.get(name) !== shape) {
      out.push(
        `export ${name} differs\n      generated: ${shape}\n      fixture:   ${actual.get(name)}`,
      );
    }
  }
  for (const [name, shape] of actual) {
    if (!expected.has(name)) {
      out.push(
        `export ${name} (${shape}) is not something the generator emits`,
      );
    }
  }
  return out;
}

/** The committed generator output for one file name: core first, then every Uplink. */
function referencesFor(repo, file) {
  const refs = [];
  const core = join("mod/sitrep-sdk/src/__generated__", file);
  if (existsSync(join(repo, core))) refs.push(core);
  for (const d of readdirSync(join(repo, "mod")).sort()) {
    const rel = join("mod", d, "client/src/__generated__", file);
    if (existsSync(join(repo, rel))) refs.push(rel);
  }
  return refs;
}

/**
 * Deletes the last export, and separately one piece of an export's schema, and
 * requires the comparison to see each. A gate that cannot tell a fixture from
 * a damaged one reports every fixture as current.
 */
function plantedDriftIsVisible(source, file) {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const expected = exportShapes(source, file);
  const cut = (from, to) => source.slice(0, from) + source.slice(to);

  const exported = sf.statements.filter(isExported);
  const last = exported.at(-1);
  if (!last) return "it found no exports to remove";
  if (
    compareShapes(
      expected,
      exportShapes(cut(last.getStart(sf), last.end), file),
    ).length === 0
  ) {
    return "removing an export went unnoticed";
  }

  for (const st of exported) {
    const member = ts.isInterfaceDeclaration(st)
      ? st.members.find(
          (m) => ts.isPropertySignature(m) && ts.isIdentifier(m.name),
        )
      : null;
    const annotation = ts.isVariableStatement(st)
      ? st.declarationList.declarations.find((d) => d.type)?.type
      : null;
    const target = member ?? annotation;
    if (!target) continue;
    const damaged = member
      ? cut(member.getStart(sf), member.end)
      : `${source.slice(0, target.getStart(sf))}unknown${source.slice(target.end)}`;
    if (compareShapes(expected, exportShapes(damaged, file)).length === 0) {
      return "changing an export's schema went unnoticed";
    }
    break;
  }
  return null;
}

/**
 * Every problem with the fixture directory, as printable lines. Empty means
 * each gated fixture exports exactly what the generator emits.
 */
export function fixtureShapeProblems(repo, fixtureDir) {
  const problems = [];
  const files = readdirSync(fixtureDir).sort();
  if (files.length === 0) return [`no fixture files found in ${fixtureDir}`];

  for (const file of files) {
    if (UNGATED[file]) continue;
    const refs = referencesFor(repo, file);
    if (refs.length === 0) {
      problems.push(
        `${file}: no generated ${file} exists under mod/ to hold it against. Either the generator stopped emitting it or the fixture is not a stand-in for generated output; if the latter, name it in UNGATED with the reason`,
      );
      continue;
    }

    const canonical = readFileSync(join(repo, refs[0]), "utf8");
    const blind = plantedDriftIsVisible(canonical, file);
    if (blind) {
      problems.push(`${file}: BLIND, ${blind} against ${refs[0]}`);
      continue;
    }

    const expected = exportShapes(canonical, refs[0]);
    const disagreeing = refs
      .slice(1)
      .filter(
        (r) =>
          compareShapes(
            expected,
            exportShapes(readFileSync(join(repo, r), "utf8"), r),
          ).length > 0,
      );
    if (disagreeing.length > 0) {
      problems.push(
        `${file}: the committed generated copies do not agree on their exports (${refs[0]} vs ${disagreeing.join(", ")}), so there is no single shape to hold the fixture to. Run mod/codegen.sh`,
      );
      continue;
    }

    const fixture = exportShapes(
      readFileSync(join(fixtureDir, file), "utf8"),
      file,
    );
    const diffs = compareShapes(expected, fixture);
    if (diffs.length > 0) {
      problems.push(
        `${file}: does not match what the generator emits (${refs.length} committed copies, ${refs[0]} first):\n${diffs
          .map((d) => `    ${d}`)
          .join("\n")}`,
      );
    }
  }
  return problems;
}
