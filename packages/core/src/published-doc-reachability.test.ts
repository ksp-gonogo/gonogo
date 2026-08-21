// @vitest-environment node
//
// Node realm rather than the package's jsdom default, matching
// `uplink-isolation.test.ts`: the shrink-only check transpiles the allowlist at
// a git ref through esbuild, which asserts a real TextEncoder/Uint8Array realm,
// and the barrel scan builds a TypeScript program over `ts.sys`.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  CS_CAPABILITY_ELECTION_PATTERNS,
  CS_CAPABILITY_SEAM_DEBT,
  CS_PRIVATE_ASSEMBLIES,
  CS_QUALIFIER_PATTERNS,
  DOC_DEBT,
  GLOBAL_IDENTIFIERS,
  PRIVATE_NPM_PACKAGES,
  PUBLISHED_PACKAGES,
  QUALIFY_WINDOW,
  RECONSTRUCTION,
  TIERS,
  type Tier,
  TS_QUALIFIER_PATTERNS,
} from "./published-doc-reachability.allowlist";

/**
 * Published-doc reachability: a doc comment on a published barrel's export may
 * not point a third-party author at a symbol no published barrel exports.
 *
 * Read `published-doc-reachability.allowlist.ts` for the five predicates, the
 * tier definitions, and the lexical discriminator that was built, measured and
 * rejected. This file is the machinery only.
 *
 * It lives in `packages/core` beside the other cross-package ratchets for the
 * same reason `uplink-isolation` does: the rule spans `mod/sitrep-sdk` and
 * `packages/ui-kit`, so it cannot live in either, and core is the package
 * neither of them may depend on.
 *
 * THIS GATE SEES WHAT THE OTHER TWO CANNOT. `uplink-isolation` checks imports
 * and `uplink-boundary` checks the outward direction; a doc comment is neither.
 * `ITargetApproachSolver` advertised a capability seam out of an unpublished
 * assembly with the C# isolation gate's debt list at zero throughout, because
 * that gate reads ProjectReferences and this is a `<c>` tag.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const BASE_REF = process.env.RATCHET_BASE_REF ?? "origin/staging";
const ALLOWLIST_PATH =
  "packages/core/src/published-doc-reachability.allowlist.ts";

const compile = (patterns: readonly (readonly [string, string])[]) =>
  patterns.map(([source, flags]) => new RegExp(source, flags));
const TS_QUALIFIERS = compile(TS_QUALIFIER_PATTERNS);
const CS_QUALIFIERS = compile(CS_QUALIFIER_PATTERNS);
const GLOBALS = new Set<string>(GLOBAL_IDENTIFIERS);
const PRIVATE_NPM = new Set<string>(PRIVATE_NPM_PACKAGES);
const CS_PRIVATE = new Set<string>(CS_PRIVATE_ASSEMBLIES);
const PUBLISHED_NAMES = new Set(PUBLISHED_PACKAGES.map((p) => p.name));

/**
 * `--cached --others --exclude-standard`, so a NEW FILE that has not been staged
 * yet is visible to the scan. Every other discovery mechanism here is
 * git-driven, and an untracked file is exactly where a fresh violation appears:
 * a `readdirSync` walk would see it and a `git ls-files` without `--others`
 * would not, which is the worse of the two failure modes because it reports
 * clean.
 */
function gitFiles(dir: string): string[] {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", dir],
    { cwd: REPO_ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);
}

const isTestFile = (f: string) =>
  /\.(test|test-d|spec)\.tsx?$/.test(f) ||
  /(^|\/)(test|tests|__tests__)\//.test(f);
const isTs = (f: string) => /\.tsx?$/.test(f);
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

function parse(rel: string, text?: string): ts.SourceFile {
  return ts.createSourceFile(
    rel,
    text ?? read(rel),
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/* ------------------------------------------------------------------ *
 * Predicate 3, half one: what each published barrel actually exports.
 * ------------------------------------------------------------------ */

/**
 * Computed with the checker rather than by reading `export` statements, so a
 * re-export chain (`export * from "./spine"`, `export { x } from "./y"`) is
 * FOLLOWED. Guessing this is what makes a reachability check untrustworthy in
 * both directions at once: under-collect and the gate manufactures findings,
 * over-collect and it masks the one it exists to catch.
 */
function barrelExports(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const pkg of PUBLISHED_PACKAGES) {
    const configPath = join(REPO_ROOT, pkg.dir, "tsconfig.json");
    const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => {
        throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
      },
    } as ts.ParseConfigFileHost);
    const entries = pkg.entries
      .map((e) => join(REPO_ROOT, pkg.dir, e))
      .filter((f) => existsSync(f));
    const program = ts.createProgram(entries, {
      ...parsed?.options,
      noEmit: true,
    });
    const checker = program.getTypeChecker();
    const names = new Set<string>();
    for (const file of entries) {
      const sf = program.getSourceFile(file);
      const symbol = sf && checker.getSymbolAtLocation(sf);
      if (!symbol) continue;
      for (const ex of checker.getExportsOfModule(symbol))
        names.add(ex.getName());
    }
    out.set(pkg.name, names);
  }
  return out;
}

/* ------------------------------------------------------------------- *
 * Predicate 4: where every repo symbol lives, so a hit can be tiered.
 * ------------------------------------------------------------------- */

/** Exported top-level TS declaration name -> the workspace packages declaring it. */
function declarationIndex(): Map<string, Set<string>> {
  const manifests = [...gitFiles("packages"), ...gitFiles("mod")].filter((f) =>
    f.endsWith("package.json"),
  );
  const pkgDirs: { dir: string; name: string }[] = [];
  for (const manifest of manifests) {
    try {
      const json = JSON.parse(read(manifest)) as { name?: string };
      if (json.name?.startsWith("@ksp-gonogo/")) {
        pkgDirs.push({
          dir: manifest.replace(/package\.json$/, ""),
          name: json.name,
        });
      }
    } catch {
      // A manifest we cannot parse is not a package boundary. Ignored rather
      // than fatal: the floor assertions catch a parse failure broad enough to
      // matter, and one bad file should not take the gate offline.
    }
  }
  // Longest directory first, so a nested package wins over its parent.
  pkgDirs.sort((a, b) => b.dir.length - a.dir.length);

  const index = new Map<string, Set<string>>();
  const sources = [...gitFiles("packages"), ...gitFiles("mod")].filter(
    (f) => isTs(f) && !isTestFile(f),
  );
  for (const file of sources) {
    const owner = pkgDirs.find((p) => file.startsWith(p.dir));
    if (!owner) continue;
    for (const st of parse(file).statements) {
      const mods = ts.canHaveModifiers(st) ? ts.getModifiers(st) : undefined;
      if (!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      const add = (name: string) => {
        if (!index.has(name)) index.set(name, new Set());
        index.get(name)?.add(owner.name);
      };
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) add(d.name.text);
        }
      } else if ("name" in st && st.name && ts.isIdentifier(st.name)) {
        add(st.name.text);
      }
    }
  }
  return index;
}

/**
 * Public C# type name -> the assemblies declaring it. A doc naming a C# host
 * type is tier T3 and ungated on the TypeScript side; the index exists so those
 * references are RECOGNISED and therefore excluded, rather than falling through
 * predicate 3 as unresolved and vanishing.
 */
function csharpTypeIndex(): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const file of gitFiles("mod").filter((f) => f.endsWith(".cs"))) {
    const assembly = file.split("/")[1];
    for (const m of read(file).matchAll(CS_TYPE_DECL)) {
      const name = m[3];
      if (!index.has(name)) index.set(name, new Set());
      index.get(name)?.add(assembly);
    }
  }
  return index;
}

const CS_TYPE_DECL =
  /^\s*public\s+((?:sealed\s+|abstract\s+|static\s+|partial\s+|readonly\s+|ref\s+)*)(class|interface|struct|enum|record(?:\s+struct)?)\s+([A-Za-z_][A-Za-z0-9_]*)(?:<[^>]*>)?\s*(?::\s*([^\r\n{]+))?/gm;

/* --------------------------------------------------------- *
 * Predicates 1 and 2: doc blocks on the published surface.
 * --------------------------------------------------------- */

/**
 * Doc-comment ranges attached to a barrel-exported declaration OR to one of its
 * members. Members matter: the `useViewUt` sentence is in the doc for
 * `CountdownProps.durationS`, not for `CountdownProps`, and a check that only
 * looked at top-level declarations would miss the case it was built for.
 */
function publishedDocRanges(
  rel: string,
  text: string,
  barrel: Set<string>,
): [number, number][] {
  const sf = parse(rel, text);
  const ranges: [number, number][] = [];
  const walk = (node: ts.Node, inside: boolean) => {
    if (inside) {
      for (const doc of ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc)) {
        ranges.push([doc.pos, doc.end]);
      }
    }
    ts.forEachChild(node, (child) => walk(child, inside));
  };
  for (const st of sf.statements) {
    const mods = ts.canHaveModifiers(st) ? ts.getModifiers(st) : undefined;
    const exported = mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const names = ts.isVariableStatement(st)
      ? st.declarationList.declarations.map((d) =>
          ts.isIdentifier(d.name) ? d.name.text : "",
        )
      : "name" in st && st.name && ts.isIdentifier(st.name)
        ? [st.name.text]
        : [];
    walk(st, !!exported && names.some((n) => barrel.has(n)));
  }
  return ranges;
}

/** Code-form references in a flattened doc block: `` `X` `` and `{@link X}`. */
function codeFormRefs(block: string): { name: string; at: number }[] {
  const refs: { name: string; at: number }[] = [];
  for (const m of block.matchAll(/\{@link(?:code|plain)?\s+([^}|\s]+)/g)) {
    refs.push({ name: m[1].split(/[.#]/)[0], at: m.index });
  }
  for (const m of block.matchAll(/`([^`\n]+)`/g)) {
    const head = m[1]
      .trim()
      .replace(/^[<{(\s]+/, "")
      .match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
    if (head) refs.push({ name: head[0], at: m.index });
  }
  return refs;
}

const isQualified = (context: string, patterns: RegExp[]) =>
  patterns.some((p) => p.test(context));

interface Finding {
  pkg: string;
  file: string;
  line: number;
  name: string;
  tier: Tier | "T3";
  qualified: boolean;
}

interface ScanResult {
  findings: Finding[];
  filesScanned: number;
  publishedDocBlocks: number;
  referencesConsidered: number;
}

/**
 * `omit` deletes a name from every computed barrel before tiering, which is how
 * the reconstruction check rebuilds the pre-fix world. It must come out of the
 * OTHER package's set as well as its own, or a cross-package reference stays
 * reachable and the plant silently fails to plant anything.
 */
function scanTypeScript(
  barrels: Map<string, Set<string>>,
  declarations: Map<string, Set<string>>,
  csharpTypes: Map<string, Set<string>>,
  omit?: string,
): ScanResult {
  const findings: Finding[] = [];
  let filesScanned = 0;
  let publishedDocBlocks = 0;
  let referencesConsidered = 0;

  for (const pkg of PUBLISHED_PACKAGES) {
    const own = new Set(barrels.get(pkg.name) ?? []);
    const elsewhere = new Set<string>();
    for (const [name, names] of barrels) {
      if (name !== pkg.name) for (const n of names) elsewhere.add(n);
    }
    if (omit) {
      own.delete(omit);
      elsewhere.delete(omit);
    }

    for (const file of gitFiles(`${pkg.dir}/src`).filter(
      (f) => isTs(f) && !isTestFile(f),
    )) {
      filesScanned++;
      const text = read(file);
      const ranges = publishedDocRanges(file, text, own);
      for (const m of text.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
        if (!ranges.some(([a, b]) => m.index >= a && m.index < b)) continue;
        publishedDocBlocks++;
        const block = m[0]
          .replace(/^[ \t]*\*[ \t]?/gm, "")
          .replace(/\s*\n\s*/g, " ");
        const line = text.slice(0, m.index).split("\n").length;
        const seen = new Set<string>();
        for (const { name, at } of codeFormRefs(block)) {
          referencesConsidered++;
          // Predicate 3: reachable, a builtin, or resolving to nothing.
          if (GLOBALS.has(name) || own.has(name) || elsewhere.has(name))
            continue;
          const owners = declarations.get(name);
          const csOwners = csharpTypes.get(name);
          if (!owners && !csOwners) continue;
          if (seen.has(`${name}@${line}`)) continue;
          seen.add(`${name}@${line}`);

          // Predicate 4.
          const ownerNames = owners ? [...owners] : [];
          const tier: Tier | "T3" = ownerNames.includes(pkg.name)
            ? "T1a"
            : ownerNames.some((n) => PUBLISHED_NAMES.has(n))
              ? "T1b"
              : ownerNames.some((n) => PRIVATE_NPM.has(n))
                ? "T2"
                : "T3";

          // Predicate 5.
          const context = block.slice(
            Math.max(0, at - QUALIFY_WINDOW),
            at + name.length + 30,
          );
          findings.push({
            pkg: pkg.name,
            file,
            line,
            name,
            tier,
            qualified: isQualified(context, TS_QUALIFIERS),
          });
        }
      }
    }
  }
  return { findings, filesScanned, publishedDocBlocks, referencesConsidered };
}

/** T1a/T1b/T2 and unqualified: the gated set. */
const gated = (findings: Finding[]) =>
  findings.filter((f) => f.tier !== "T3" && !f.qualified);

function tsDebtNow(
  findings: Finding[],
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const f of gated(findings)) {
    out[f.file] ??= {};
    out[f.file][f.tier] = (out[f.file][f.tier] ?? 0) + 1;
  }
  return out;
}

/* ------------------------------- *
 * The C# half.
 * ------------------------------- */

interface CsScan {
  findings: { file: string; line: number; name: string }[];
  filesScanned: number;
  docLines: number;
  electedCapabilities: Set<string>;
}

/**
 * Capability seams are DERIVED from the mod source rather than listed, so a new
 * election joins the rule the day it is written. The seam that motivated this
 * survived precisely because nobody remembered to add it to anything, and it has
 * since been merged into `IPropagationProvider`: closest approach is a
 * consequence of a trajectory, not a capability beside one.
 */
function scanCsharp(): CsScan {
  const files = gitFiles("mod").filter((f) => f.endsWith(".cs"));
  const electionPatterns = CS_CAPABILITY_ELECTION_PATTERNS.map(
    (p) => new RegExp(p, "g"),
  );
  const elected = new Set<string>();
  const typeAssemblies = new Map<string, Set<string>>();
  const baseTypes = new Map<string, string[]>();
  const contents = new Map<string, string>();

  for (const file of files) {
    const text = read(file);
    contents.set(file, text);
    for (const pattern of electionPatterns) {
      for (const m of text.matchAll(pattern)) elected.add(m[1]);
    }
    const assembly = file.split("/")[1];
    for (const m of text.matchAll(CS_TYPE_DECL)) {
      const name = m[3];
      if (!typeAssemblies.has(name)) typeAssemblies.set(name, new Set());
      typeAssemblies.get(name)?.add(assembly);
      if (m[4]) {
        baseTypes.set(
          name,
          (baseTypes.get(name) ?? []).concat(
            m[4].split(",").map((s) => s.trim().replace(/<.*/, "")),
          ),
        );
      }
    }
  }

  const publishedAssemblies = new Set(
    files.map((f) => f.split("/")[1]).filter((a) => /\.Contract$/.test(a)),
  );
  const onSeam = (name: string) =>
    elected.has(name) ||
    (baseTypes.get(name) ?? []).some((b) => elected.has(b));

  const findings: CsScan["findings"] = [];
  let filesScanned = 0;
  let docLines = 0;

  for (const file of files) {
    const assembly = file.split("/")[1];
    if (!publishedAssemblies.has(assembly)) continue;
    filesScanned++;
    const lines = (contents.get(file) ?? "").split("\n");
    const isDoc = (i: number) =>
      i >= 0 && i < lines.length && /^\s*\/\/\//.test(lines[i]);
    for (let i = 0; i < lines.length; i++) {
      if (!isDoc(i)) continue;
      docLines++;
      // The qualifier window spans the whole doc block, not one `///` line: the
      // assembly that qualifies a mention is routinely a sentence away.
      let from = i;
      while (isDoc(from - 1)) from--;
      let to = i;
      while (isDoc(to + 1)) to++;
      const block = lines
        .slice(from, to + 1)
        .map((l) => l.replace(/^\s*\/\/\/\s?/, ""))
        .join(" ");

      const refs = new Set<string>();
      for (const m of lines[i].matchAll(
        /cref\s*=\s*"(?:[A-Za-z]:)?([A-Za-z0-9_.]+)/g,
      )) {
        refs.add(m[1]);
      }
      for (const m of lines[i].matchAll(/<c>([^<]+)<\/c>/g)) {
        const head = m[1].trim().match(/^[A-Za-z_][A-Za-z0-9_.]*/);
        if (head) refs.add(head[0]);
      }
      for (const m of lines[i].matchAll(/`([^`\n]+)`/g)) {
        const head = m[1].trim().match(/^[A-Za-z_][A-Za-z0-9_.]*/);
        if (head) refs.add(head[0]);
      }

      for (const full of refs) {
        const head = full.split(".")[0];
        const where = typeAssemblies.get(head);
        if (!where) continue;
        const reachable = [...where].some(
          (a) =>
            a === assembly || a === "Sitrep.Contract" || !CS_PRIVATE.has(a),
        );
        if (reachable) continue;
        if (!onSeam(head)) continue;
        const at = block.indexOf(head);
        const context = block.slice(
          Math.max(0, at - QUALIFY_WINDOW),
          at + head.length + 30,
        );
        if (isQualified(context, CS_QUALIFIERS)) continue;
        findings.push({ file, line: i + 1, name: head });
      }
    }
  }
  return { findings, filesScanned, docLines, electedCapabilities: elected };
}

/* ------------------------------- *
 * Shared scan, computed once.
 * ------------------------------- */

const BARRELS = barrelExports();
const DECLARATIONS = declarationIndex();
const CSHARP_TYPES = csharpTypeIndex();
const TS_SCAN = scanTypeScript(BARRELS, DECLARATIONS, CSHARP_TYPES);
const CS_SCAN = scanCsharp();

describe("published doc reachability", () => {
  /**
   * INSTRUMENT CHECKS FIRST, before any assertion that could pass by finding
   * nothing. A regex matching nothing must FAIL, not pass. Every number here is
   * a floor set well under the census measurement, so ordinary growth never
   * trips it and a scan that has gone blind always does.
   */
  describe("the scan is not blind", () => {
    it("computed both published barrels", () => {
      expect(BARRELS.get("@ksp-gonogo/sitrep-sdk")?.size ?? 0).toBeGreaterThan(
        700,
      );
      expect(BARRELS.get("@ksp-gonogo/ui-kit")?.size ?? 0).toBeGreaterThan(300);
    });

    /**
     * Spot-checks in BOTH directions. An over-broad barrel set masks real
     * findings and cannot be told from a correct one by counting.
     */
    it("resolved re-export chains without over-collecting", () => {
      const sdk = BARRELS.get("@ksp-gonogo/sitrep-sdk") ?? new Set();
      const kit = BARRELS.get("@ksp-gonogo/ui-kit") ?? new Set();
      for (const name of ["useTelemetry", "registerAugment", "AugmentSlot"]) {
        expect(sdk, `sdk barrel should export ${name}`).toContain(name);
      }
      for (const name of ["Countdown", "CountdownProps"]) {
        expect(kit, `ui-kit barrel should export ${name}`).toContain(name);
      }
      expect(sdk).not.toContain("formatQuantity");
      expect(kit).not.toContain("getHost");
    });

    it("scanned the published TypeScript sources", () => {
      expect(TS_SCAN.filesScanned).toBeGreaterThan(220);
      expect(TS_SCAN.publishedDocBlocks).toBeGreaterThan(1300);
      expect(TS_SCAN.referencesConsidered).toBeGreaterThan(4000);
    });

    it("indexed the repo's declarations", () => {
      expect(DECLARATIONS.size).toBeGreaterThan(2500);
      expect(CSHARP_TYPES.size).toBeGreaterThan(800);
    });

    it("scanned the published C# contracts", () => {
      expect(CS_SCAN.filesScanned).toBeGreaterThan(90);
      expect(CS_SCAN.docLines).toBeGreaterThan(7000);
    });

    /**
     * The capability seams the C# half tiers on. Derived from `Kernel.Query<T>`
     * type arguments, so a rename of the kernel's query method would leave the
     * set empty and the C# half would report clean forever.
     */
    it("derived the capability seams from the kernel", () => {
      expect(CS_SCAN.electedCapabilities.size).toBeGreaterThan(5);
      for (const seam of [
        "IPropagationProvider",
        "IActionGroupsBackend",
        "ICommsBackend",
      ]) {
        expect(
          CS_SCAN.electedCapabilities,
          `${seam} should be elected`,
        ).toContain(seam);
      }
    });

    /**
     * THE WARRANTY. `useViewUt` is exported today, so the motivating bug cannot
     * be observed live; the instrument is validated against a rebuilt instance
     * of it instead. Delete the symbol from both computed barrels and
     * `Countdown.tsx`'s "Subtract the frame's view time first (`useViewUt`)"
     * must come back as an unqualified T1b violation.
     *
     * This is the check that stops the gate going green for the wrong reason. A
     * broken path, a renamed entry point, a doc-range walk that stops
     * descending into members, or a regex that quietly stopped matching all
     * produce zero findings, and zero findings reads as a clean repo.
     */
    it("sees the reconstructed useViewUt violation", () => {
      const live = gated(TS_SCAN.findings).filter(
        (f) => f.name === RECONSTRUCTION.symbol,
      );
      expect(
        live,
        [
          `${RECONSTRUCTION.symbol} is exported from ${RECONSTRUCTION.declaredIn}`,
          "today, so the live scan must NOT flag it. If this fails, the symbol",
          "left the barrel and the finding above is real.",
        ].join("\n"),
      ).toEqual([]);

      const planted = gated(
        scanTypeScript(
          BARRELS,
          DECLARATIONS,
          CSHARP_TYPES,
          RECONSTRUCTION.symbol,
        ).findings,
      ).filter((f) => f.name === RECONSTRUCTION.symbol);

      expect(
        planted.map((f) => `${f.file} [${f.tier}]`),
        [
          "BLIND: the planted violation was not seen.",
          "",
          `With ${RECONSTRUCTION.symbol} removed from both computed barrels,`,
          `${RECONSTRUCTION.file} documents an operation an author cannot`,
          "perform, which is the exact bug this gate exists to catch. Not seeing",
          "it means the scan is broken, not that the repo is clean.",
          "",
          "Check in order: the barrel entry points in the allowlist, the doc-range",
          "walk descending into MEMBERS (the reference is on a property, not the",
          "interface), and the code-form regexes.",
        ].join("\n"),
      ).toContain(`${RECONSTRUCTION.file} [${RECONSTRUCTION.tier}]`);
    });
  });

  it("no published doc points outside the barrels beyond the debt list", () => {
    const now = tsDebtNow(TS_SCAN.findings);
    const over: string[] = [];
    for (const [file, tiers] of Object.entries(now)) {
      for (const [tier, count] of Object.entries(tiers)) {
        const allowed = DOC_DEBT[file]?.[tier as Tier] ?? 0;
        if (count > allowed) {
          over.push(`${file} [${tier}] ${count} > ${allowed} allowed`);
        }
      }
    }
    expect(
      over,
      [
        "A published doc comment points at a symbol no published barrel exports.",
        "",
        "A third-party author reading it is told about something they cannot",
        "import. Three ways out, best first:",
        "",
        "1. QUALIFY THE MENTION. If it is provenance, say where the thing lives:",
        "   `useDataSeries` becomes `@ksp-gonogo/data`'s `useDataSeries`. The doc",
        "   gets strictly better and the gate stops caring.",
        "2. MOVE THE EXPORT onto the published barrel, if the doc is right that",
        "   the reader needs it.",
        "3. REWRITE THE SENTENCE so it does not point outside.",
        "",
        "Do NOT raise the debt count: it is shrink-only, and a raised number",
        "means new code just created the violation.",
        "",
        "See published-doc-reachability.allowlist.ts for the five predicates.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("no published C# contract advertises a capability seam beyond the debt list", () => {
    const now: Record<string, number> = {};
    for (const f of CS_SCAN.findings) now[f.file] = (now[f.file] ?? 0) + 1;
    const over: string[] = [];
    for (const [file, count] of Object.entries(now)) {
      const allowed = CS_CAPABILITY_SEAM_DEBT[file] ?? 0;
      if (count > allowed) over.push(`${file} ${count} > ${allowed} allowed`);
    }
    expect(
      over,
      [
        "A published contract doc names a private type on a CAPABILITY SEAM.",
        "",
        "The seam is elected through the kernel, so the doc is describing an",
        "extension point to an author who cannot reference the assembly it names.",
        "That is the `IActionGroupsBackend` bug, and the C# isolation gate cannot",
        "see it: it reads ProjectReferences and this is a doc comment.",
        "",
        "Fix it by moving the named type into `Sitrep.Contract` (a contract change",
        "is free), or by qualifying the mention with its assembly if it really is",
        "provenance.",
      ].join("\n"),
    ).toEqual([]);
  });

  /**
   * The staleness direction. Nothing else here notices a debt entry whose
   * violation is already gone, so a fix elsewhere leaves the number behind and
   * the list can never reach zero by attrition: someone has to spot each dead
   * line by hand. `uplink-isolation` grew a dozen stale entries exactly this way
   * when publishing the render harness fixed a dozen files at a stroke.
   *
   * Derived from the same scan as the gate, so it has no upkeep of its own and
   * cannot itself go stale.
   */
  it("lists no debt that is already fixed", () => {
    const now = tsDebtNow(TS_SCAN.findings);
    const stale: string[] = [];
    for (const [file, tiers] of Object.entries(DOC_DEBT)) {
      for (const [tier, allowed] of Object.entries(tiers)) {
        const count = now[file]?.[tier] ?? 0;
        if (count < (allowed ?? 0)) {
          stale.push(`${file} [${tier}] allows ${allowed}, found ${count}`);
        }
      }
    }
    const csNow: Record<string, number> = {};
    for (const f of CS_SCAN.findings) csNow[f.file] = (csNow[f.file] ?? 0) + 1;
    for (const [file, allowed] of Object.entries(CS_CAPABILITY_SEAM_DEBT)) {
      const count = csNow[file] ?? 0;
      if (count < allowed) {
        stale.push(`${file} allows ${allowed}, found ${count}`);
      }
    }
    expect(
      stale,
      [
        "The debt list allows more than the scan finds.",
        "",
        "Good news: something fixed it. Lower the count(s) above, or delete the",
        "entry, so the list keeps telling the truth about what is left. A debt",
        "list that outlives its debt reads as work remaining and hides how close",
        "to zero this is.",
      ].join("\n"),
    ).toEqual([]);
  });

  describe("the debt lists only ever shrink", () => {
    /**
     * The allowlist at `BASE_REF`, or `undefined` when there is no base (first
     * land, shallow clone, detached CI ref) and there is nothing to diff
     * against. Soft-pass in that case, same as the other ratchets.
     */
    function baseAllowlist(): Record<string, unknown> | undefined {
      let source: string;
      try {
        source = execFileSync(
          "git",
          ["show", `${BASE_REF}:${ALLOWLIST_PATH}`],
          {
            cwd: REPO_ROOT,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
      } catch {
        return undefined;
      }
      const js = transformSync(source, { loader: "ts", format: "cjs" }).code;
      const module_ = { exports: {} as Record<string, unknown> };
      new Function("module", "exports", js)(module_, module_.exports);
      return module_.exports;
    }

    it("DOC_DEBT", () => {
      const base = baseAllowlist();
      const baseDebt = base?.DOC_DEBT as
        | Record<string, Partial<Record<Tier, number>>>
        | undefined;
      if (!baseDebt) return;
      const grown: string[] = [];
      for (const [file, tiers] of Object.entries(DOC_DEBT)) {
        for (const [tier, count] of Object.entries(tiers)) {
          const before = baseDebt[file]?.[tier as Tier] ?? 0;
          if ((count ?? 0) > before) {
            grown.push(`${file} [${tier}] ${before} -> ${count}`);
          }
        }
      }
      expect(
        grown,
        [
          `Debt may only be LOWERED, never raised, vs ${BASE_REF}.`,
          "",
          "Per-file AND per-tier on purpose: one file's fix must not pay for",
          "another file's regression, and a T1b instance appearing while three T2",
          "ones are fixed is the original bug coming back under cover of",
          "progress.",
        ].join("\n"),
      ).toEqual([]);
    });

    it("CS_CAPABILITY_SEAM_DEBT", () => {
      const base = baseAllowlist();
      const baseDebt = base?.CS_CAPABILITY_SEAM_DEBT as
        | Record<string, number>
        | undefined;
      // Absent at base: the list was seeded after BASE_REF, so every entry is
      // the seed rather than growth. Graded from the next commit onwards.
      if (!baseDebt) return;
      const grown = Object.entries(CS_CAPABILITY_SEAM_DEBT)
        .filter(([file, count]) => count > (baseDebt[file] ?? 0))
        .map(([file, count]) => `${file} ${baseDebt[file] ?? 0} -> ${count}`);
      expect(
        grown,
        `Capability-seam debt may only be LOWERED, never raised, vs ${BASE_REF}.`,
      ).toEqual([]);
    });

    /**
     * The debt lists shrink; the lists of what COUNTS as debt do the opposite.
     * Dropping a name from any of these looks exactly like progress from every
     * other angle in this file: the scan stops finding it, its entries can be
     * deleted as cleared, and the shrink checks stop grading it. The suite goes
     * green by no longer asking the question.
     *
     * `uplink-isolation` has the same guard and it is there because clearing two
     * entries with a regex over the file matched the `FORBIDDEN_PACKAGES`
     * members too, and the full suite passed with a package silently unguarded.
     */
    it("the rule never narrows", () => {
      const base = baseAllowlist();
      if (!base) return;
      const narrowed: string[] = [];

      const compare = (
        label: string,
        before: readonly string[] | undefined,
        after: readonly string[],
      ) => {
        if (!before) return;
        const now = new Set(after);
        for (const name of before) {
          if (!now.has(name)) narrowed.push(`${label}: ${name}`);
        }
      };

      compare(
        "TIERS",
        base.TIERS ? Object.keys(base.TIERS as object) : undefined,
        Object.keys(TIERS),
      );
      compare(
        "PRIVATE_NPM_PACKAGES",
        base.PRIVATE_NPM_PACKAGES as readonly string[] | undefined,
        PRIVATE_NPM_PACKAGES,
      );
      compare(
        "CS_PRIVATE_ASSEMBLIES",
        base.CS_PRIVATE_ASSEMBLIES as readonly string[] | undefined,
        CS_PRIVATE_ASSEMBLIES,
      );
      compare(
        "PUBLISHED_PACKAGES",
        (
          base.PUBLISHED_PACKAGES as readonly { name: string }[] | undefined
        )?.map((p) => p.name),
        PUBLISHED_PACKAGES.map((p) => p.name),
      );
      compare(
        "CS_CAPABILITY_ELECTION_PATTERNS",
        base.CS_CAPABILITY_ELECTION_PATTERNS as readonly string[] | undefined,
        CS_CAPABILITY_ELECTION_PATTERNS,
      );

      expect(
        narrowed,
        [
          `The rule's SUBJECT narrowed vs ${BASE_REF}.`,
          "",
          "These lists may widen, never narrow. A doc pointing at a private",
          "package is unreadable to an outside author whether or not this file",
          "still names the package, and removing the name only stops the guard",
          "asking.",
          "",
          "If the violations are gone, lower the DEBT COUNTS and leave these",
          "lists alone so the next one is caught.",
        ].join("\n"),
      ).toEqual([]);
    });

    /**
     * Predicate 5 is the escape valve, so it is the list most likely to be
     * WIDENED to make an inconvenient finding disappear. It may grow, but the
     * C# list must never acquire the informal patterns: "MOD-side" says where a
     * computation happens and not where a type lives, and adding it back marks
     * `ITargetApproachSolver` as qualified, which is measured and is how the two
     * lists came to be separate.
     */
    it("the C# qualifier list stays free of informal patterns", () => {
      const informal = CS_QUALIFIER_PATTERNS.filter(([source]) =>
        /-side|\bthe \(\?:app/.test(source),
      );
      expect(
        informal,
        [
          "An informal qualifier reached the C# list.",
          "",
          "Every doc comment in Sitrep.Contract is about the mod, so 'mod-side'",
          "and 'the host's' qualify nothing there. Adding one marks",
          "VesselTarget.cs's 'computed MOD-side by the elected",
          "ITargetApproachSolver' as provenance and drops the most important",
          "finding on this side of the tree.",
        ].join("\n"),
      ).toEqual([]);
    });
  });
});
