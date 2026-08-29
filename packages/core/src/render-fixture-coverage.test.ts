// @vitest-environment node
//
// The real Node realm rather than the package's jsdom default, for the same
// reason `uplink-boundary.test.ts` states: esbuild's `transformSync` asserts
// `new TextEncoder().encode("") instanceof Uint8Array` and throws "JavaScript
// environment is broken" under jsdom. Nothing here touches the DOM.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type RatchetBase,
  ratchetBaseRef,
  sourceAtRatchetBase,
} from "./ratchetBaseRef";
import { COINCIDENTAL, RENDER_GAP } from "./render-fixture-coverage.debt";

/**
 * Tested, but render-invisible: a payload field the widget reads that no
 * fixture ever carries.
 *
 * <p>The failure this exists for is stable and silent. A widget's payload gains
 * fields, unit tests cover them, and every fixture keeps the old shape, so the
 * one artefact a human actually looks at, the render, shows the behaviour that
 * was there before. Nothing goes red. Three instances landed in one week:
 * `reliability.summary.coverage`'s unreadable-part states, six Principia
 * ground-track rows that stopped every render at LOWEST until commit
 * `a718dd36a` gave them a fixture, and a ThermalStatus characterisation that
 * was green because it read the frame before its own emit.</p>
 *
 * <h3>The approximation, and what it cannot see</h3>
 *
 * <p>Three sets per widget, all keyed on FIELD NAMES:</p>
 *
 * <ul>
 * <li><b>universe</b>: the transitive field names the generated units
 *   descriptors give for the topics that widget's fixtures emit. Generated from
 *   the C# contract, so it is the one half of this that is not a guess</li>
 * <li><b>populated</b>: every key reached under `_stream.emits[].payload` (or
 *   `.value`) in any JSON fixture in that widget's `__fixtures__` dir, nesting
 *   and arrays included, counting a key only when its value is NOT null</li>
 * <li><b>read</b>: identifiers the widget's own non-test `.ts`/`.tsx` files
 *   dereference (`.field`, or a destructuring binding), after esbuild strips
 *   the types and a second pass blanks strings and comments, intersected with
 *   the universe</li>
 * </ul>
 *
 * <p>The gap is `read` minus `populated`. It is a NAME comparison and it is
 * unsound in both directions, deliberately, because the sound version needs
 * real dataflow and this one needs a regex:</p>
 *
 * <ul>
 * <li>it cannot tell a payload deref from a coincidence, so a plot coordinate
 *   `x` or the `Reading` discriminant `state` reads as a field: that is what
 *   `COINCIDENTAL` in the sibling debt module absorbs, 18 of the 65 seeded
 *   findings</li>
 * <li>it is blind to any topic the descriptors do not carry, which today
 *   includes `vessel.state`, `crash.hasRecent` and every `*.available` flag, so
 *   a widget reading only those is graded against an empty universe</li>
 * <li>it reads only files sitting directly IN the widget's own directory, so a
 *   field dereferenced in a shared helper a level up is invisible</li>
 * <li>it unions the universes of every topic the fixtures emit, so a field read
 *   off topic A and populated by topic B reads as covered</li>
 * <li>it grades presence, never value, so a fixture carrying the field with a
 *   value that never enters the branch counts as covered: it would not have
 *   caught the ThermalStatus ordering bug at all</li>
 * <li>a string-blanking pass blanks styled-components template interpolations
 *   with them, so a read that happens only inside one is missed, and so is a
 *   quoted index access `payload["field"]`</li>
 * </ul>
 *
 * <p>All of which is why the ratchet has two lists and not one, and why the
 * seeded numbers are quoted rather than the gate claiming a clean tree.</p>
 *
 * <h3>It can fail</h3>
 *
 * <p>Demonstrated on the worked example rather than asserted. Reverting
 * `mod/GonogoPrincipiaUplink/client/src/OrbitAnalysis/__fixtures__/orbit-analysis-live.json`
 * to its `a718dd36a^` content, which is the state the tree was in when the
 * ground-track rows shipped invisible, makes this gate name six of them:</p>
 *
 * <pre>
 *   Render-invisible payload field(s) ...
 *     mod/.../OrbitAnalysis#ascendingCrossingDegrees
 *     mod/.../OrbitAnalysis#ascendingNodeSolarTimeDegrees
 *     mod/.../OrbitAnalysis#descendingCrossingDegrees
 *     mod/.../OrbitAnalysis#recurrenceCycleRotations
 *     mod/.../OrbitAnalysis#recurrenceRevolutions
 *     mod/.../OrbitAnalysis#recurrenceSubcycleRotations
 * </pre>
 *
 * <p>Six of the ten fields that commit added, not ten: the other four are read
 * only through a helper a directory up, which is the "own directory" blind spot
 * above, seen here rather than argued about. Restoring the fixture returns the
 * gate to green. The synthetic cases further down check the same rule without
 * the filesystem, and a liveness assertion checks the descriptors actually
 * loaded, because a scan whose input failed to load finds nothing and finding
 * nothing is what passing looks like here.</p>
 */

interface UnitsDescriptor {
  /** Topic -> scalar leaf field -> unit token. */
  topics?: Record<string, Record<string, string>>;
  /** Topic -> nested field -> type name. */
  topicShapes?: Record<string, Record<string, string>>;
  /** Type -> scalar leaf field -> unit token. */
  types?: Record<string, Record<string, string>>;
  /** Type -> nested field -> type name. */
  typeShapes?: Record<string, Record<string, string>>;
}

/**
 * Envelope types every topic carries, which are not part of anyone's payload.
 *
 * `PayloadMeta` is `{ quality, source }` and appears in `topicShapes` for
 * nearly every topic. Left in, "source" became a phantom finding on any widget
 * with a `<img src>` or a named provider.
 */
const ENVELOPE_TYPES = new Set(["PayloadMeta"]);

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "bin",
  "obj",
  "coverage",
  ".turbo",
]);

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

/**
 * Every generated units descriptor, merged.
 *
 * Found by shape rather than listed: the sdk's, plus one per Uplink client. A
 * new Uplink is graded the day it lands, and one that has not generated a
 * descriptor yet simply contributes no universe, which shows up as its widgets
 * reporting nothing rather than as a crash.
 */
function loadDescriptors(): UnitsDescriptor {
  const paths = [join(ROOT, "mod/sitrep-sdk/src/__generated__/units.json")];
  for (const entry of readdirSync(join(ROOT, "mod"))) {
    const candidate = join(
      ROOT,
      "mod",
      entry,
      "client/src/__generated__/units.json",
    );
    if (existsSync(candidate)) paths.push(candidate);
  }
  const merged: Required<UnitsDescriptor> = {
    topics: {},
    topicShapes: {},
    types: {},
    typeShapes: {},
  };
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as UnitsDescriptor;
    Object.assign(merged.topics, parsed.topics ?? {});
    Object.assign(merged.topicShapes, parsed.topicShapes ?? {});
    Object.assign(merged.types, parsed.types ?? {});
    Object.assign(merged.typeShapes, parsed.typeShapes ?? {});
  }
  return merged;
}

/** `*Foo` and `Foo[]` both name the type `Foo` in the descriptors. */
function bareTypeName(name: string): string {
  return name.replace(/^\*/, "").replace(/\[\]$/, "");
}

/** Every field name reachable from a type, following nested types once each. */
function typeFieldNames(
  descriptor: UnitsDescriptor,
  typeName: string,
  seen: Set<string> = new Set(),
): Set<string> {
  const bare = bareTypeName(typeName);
  const out = new Set<string>();
  if (ENVELOPE_TYPES.has(bare) || seen.has(bare)) return out;
  seen.add(bare);
  for (const field of Object.keys(descriptor.types?.[bare] ?? {})) {
    out.add(field);
  }
  for (const [field, nested] of Object.entries(
    descriptor.typeShapes?.[bare] ?? {},
  )) {
    if (ENVELOPE_TYPES.has(bareTypeName(nested))) continue;
    out.add(field);
    for (const name of typeFieldNames(descriptor, nested, seen)) out.add(name);
  }
  return out;
}

/** Every field name a topic's payload can carry, or null when it has no descriptor. */
function topicFieldNames(
  descriptor: UnitsDescriptor,
  topic: string,
): Set<string> | null {
  const scalars = descriptor.topics?.[topic];
  const shape = descriptor.topicShapes?.[topic];
  if (!scalars && !shape) return null;
  const out = new Set(Object.keys(scalars ?? {}));
  for (const [field, nested] of Object.entries(shape ?? {})) {
    if (ENVELOPE_TYPES.has(bareTypeName(nested))) continue;
    out.add(field);
    for (const name of typeFieldNames(descriptor, nested)) out.add(name);
  }
  return out;
}

/**
 * Keys a fixture actually carries, recursing through objects and arrays.
 *
 * A key whose value is null does NOT count. That is the case the gate is for:
 * `"firstCollisionUt": null` is a fixture declaring the field's ABSENCE, and
 * the row that renders it is as unseen as if the key were missing.
 */
function collectPopulatedFields(
  value: unknown,
  out: Set<string> = new Set(),
): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectPopulatedFields(item, out);
    return out;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (nested === null || nested === undefined) continue;
      out.add(key);
      collectPopulatedFields(nested, out);
    }
  }
  return out;
}

/**
 * Source with types, comments and string literals gone.
 *
 * esbuild first, for the reason `uplink-boundary.test.ts` had to switch to it:
 * a character state machine cannot tell an apostrophe in JSX text from an
 * opening quote, desynchronises, and then blanks the code after it, which is a
 * gate that silently stops looking. esbuild turns JSX text into ordinary string
 * literals with ordinary escapes, and the machine below is exact on those.
 * Stripping types matters as much: a `mach?: number | null` in a local
 * interface is a declaration, not a read, and counting it would make every
 * widget report its own type definitions back.
 */
function codeOnly(source: string, path: string): string {
  try {
    const js = transformSync(source, {
      loader: path.endsWith(".tsx") ? "tsx" : "ts",
      format: "esm",
    }).code;
    return blankStringsAndComments(js);
  } catch {
    return blankStringsAndComments(source);
  }
}

function blankStringsAndComments(source: string): string {
  let out = "";
  let i = 0;
  let state: "code" | "line" | "block" | "'" | '"' | "`" = "code";
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (state === "code") {
      if (char === "/" && next === "/") {
        state = "line";
        out += "  ";
        i += 2;
        continue;
      }
      if (char === "/" && next === "*") {
        state = "block";
        out += "  ";
        i += 2;
        continue;
      }
      if (char === "'" || char === '"' || char === "`") {
        state = char;
        out += " ";
        i += 1;
        continue;
      }
      out += char;
      i += 1;
      continue;
    }
    if (state === "line") {
      if (char === "\n") {
        state = "code";
        out += "\n";
      } else {
        out += " ";
      }
      i += 1;
      continue;
    }
    if (state === "block") {
      if (char === "*" && next === "/") {
        state = "code";
        out += "  ";
        i += 2;
        continue;
      }
      out += char === "\n" ? "\n" : " ";
      i += 1;
      continue;
    }
    if (char === "\\") {
      out += "  ";
      i += 2;
      continue;
    }
    if (char === state) state = "code";
    out += char === "\n" ? "\n" : " ";
    i += 1;
  }
  return out;
}

/**
 * Identifiers the source dereferences: `.field` and `{ field } = ...`.
 *
 * A quoted index access, `payload["field"]`, is deliberately NOT matched. The
 * string it needs has already been blanked by the pass above, and matching it
 * on the raw source instead would take every string in an array literal with
 * it, so a `paints: ["ROTOR"]` scene declaration would read as a field.
 */
function dereferencedNames(strippedSource: string): Set<string> {
  const out = new Set<string>();
  for (const match of strippedSource.matchAll(/\.([A-Za-z_$][\w$]*)/g)) {
    out.add(match[1]);
  }
  for (const match of strippedSource.matchAll(/\{([^{}]*)\}\s*=/g)) {
    for (const part of match[1].split(",")) {
      // `{ a: b }` binds b and READS a, so the key is the field name.
      const name = part.trim().split(":")[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) out.add(name);
    }
  }
  return out;
}

interface WidgetScan {
  /** Repo-relative widget directory. */
  dir: string;
  topics: string[];
  /** Topics no descriptor knows about, so nothing about them can be graded. */
  ungraded: string[];
  universe: Set<string>;
  populated: Set<string>;
  gap: string[];
}

/** Every directory holding a `__fixtures__` dir, under packages and Uplink clients. */
function widgetDirs(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const path = join(dir, name);
      if (!statSync(path).isDirectory()) continue;
      if (name === "__fixtures__") {
        found.push(dir);
        continue;
      }
      walk(path);
    }
  };
  for (const pkg of readdirSync(join(ROOT, "packages"))) {
    const src = join(ROOT, "packages", pkg, "src");
    if (existsSync(src)) walk(src);
  }
  for (const uplink of readdirSync(join(ROOT, "mod"))) {
    const src = join(ROOT, "mod", uplink, "client/src");
    if (existsSync(src)) walk(src);
  }
  return found.sort();
}

function scanWidget(descriptor: UnitsDescriptor, dir: string): WidgetScan {
  const fixtureDir = join(dir, "__fixtures__");
  const populated = new Set<string>();
  const topics = new Set<string>();
  for (const name of readdirSync(fixtureDir)) {
    if (!name.endsWith(".json")) continue;
    let fixture: {
      _stream?: {
        emits?: Array<{
          topic?: string;
          channel?: string;
          payload?: unknown;
          value?: unknown;
        }>;
      };
    };
    try {
      fixture = JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
    } catch {
      // A fixture that will not parse is a different gate's problem; skipping
      // it here loses one fixture's worth of coverage, never the whole scan.
      continue;
    }
    for (const emit of fixture._stream?.emits ?? []) {
      const topic = emit.topic ?? emit.channel;
      if (topic) topics.add(topic);
      collectPopulatedFields(emit.payload ?? emit.value, populated);
    }
  }

  const universe = new Set<string>();
  const ungraded: string[] = [];
  for (const topic of topics) {
    const fields = topicFieldNames(descriptor, topic);
    if (!fields) {
      ungraded.push(topic);
      continue;
    }
    for (const field of fields) universe.add(field);
  }

  const dereferenced = new Set<string>();
  for (const name of readdirSync(dir)) {
    if (!/\.tsx?$/.test(name)) continue;
    if (/\.(test|characterise|test-d)\./.test(name)) continue;
    const stripped = codeOnly(readFileSync(join(dir, name), "utf8"), name);
    for (const id of dereferencedNames(stripped)) dereferenced.add(id);
  }

  const gap = [...universe]
    .filter((field) => dereferenced.has(field) && !populated.has(field))
    .sort();

  return {
    dir: relative(ROOT, dir),
    topics: [...topics].sort(),
    ungraded: ungraded.sort(),
    universe,
    populated,
    gap,
  };
}

let scans: WidgetScan[] | undefined;
function scanAll(): WidgetScan[] {
  if (scans) return scans;
  const descriptor = loadDescriptors();
  scans = widgetDirs().map((dir) => scanWidget(descriptor, dir));
  return scans;
}

const entryFor = (scan: WidgetScan, field: string) => `${scan.dir}#${field}`;

describe("render-fixture coverage: a field the widget reads is a field some fixture carries", () => {
  beforeAll(() => {
    scanAll();
  }, 120_000);

  it("finds no field that is read but never fed", () => {
    const found = new Set<string>();
    for (const scan of scanAll()) {
      for (const field of scan.gap) found.add(entryFor(scan, field));
    }
    const declared = new Set([...COINCIDENTAL, ...RENDER_GAP]);

    const undeclared = [...found].filter((e) => !declared.has(e)).sort();
    const stale = [...declared].filter((e) => !found.has(e)).sort();

    if (undeclared.length > 0) {
      throw new Error(
        "Render-invisible payload field(s): the widget's own source " +
          "dereferences them, they belong to a topic its fixtures emit, and no " +
          "fixture carries them with a non-null value, so no render has ever " +
          "shown them:\n" +
          undeclared.map((e) => `  ${e}`).join("\n") +
          "\n\nFIX THE FIXTURE FIRST, that is the point of this gate. Add or " +
          "extend a fixture in that widget's __fixtures__ dir so the field is " +
          "carried, then look at the render it produces: commit a718dd36a is " +
          "the worked example, six ground-track rows that had tests and " +
          "nothing to look at.\n" +
          "If the match is a COINCIDENCE (a plot coordinate `x`, a canvas " +
          "`ctx.arc`, a local spec's `id`, the Reading discriminant `state`), " +
          "add it to COINCIDENTAL in " +
          "packages/core/src/render-fixture-coverage.debt.ts, quoting the line " +
          "that earned it.\n" +
          "RENDER_GAP is shrink-only and is NOT a place to record a new gap: " +
          "the next test refuses entries added there.",
      );
    }

    if (stale.length > 0) {
      throw new Error(
        "Stale render-fixture-coverage entries: these no longer describe " +
          "anything the scan finds (a fixture now carries the field, the read " +
          "went away, or the widget moved). Delete the line(s) from " +
          "packages/core/src/render-fixture-coverage.debt.ts in the same " +
          "commit, which is what ratchets the gate down:\n" +
          stale.map((e) => `  ${e}`).join("\n"),
      );
    }

    expect(undeclared).toEqual([]);
    expect(stale).toEqual([]);
  }, 60_000);

  /**
   * The scan can see, so "nothing found" means something.
   *
   * An allowlist-shaped assertion is satisfied by finding nothing, so a scan
   * whose descriptors failed to load reports a perfect tree. These three ask
   * whether the instrument had any input at all, and they are about the
   * apparatus rather than about anybody's debt, so none of them names a widget
   * that paying it down would remove.
   */
  it("loaded descriptors, fixtures and sources rather than an empty tree", () => {
    const all = scanAll();
    expect(all.length).toBeGreaterThan(40);
    const graded = all.filter((s) => s.universe.size > 0);
    expect(graded.length).toBeGreaterThan(40);
    expect(all.some((s) => s.gap.length > 0)).toBe(true);
  });
});

describe("the gap rule itself, on synthetic input", () => {
  // Pure logic, no filesystem: the rule is checked here before the scan above
  // is trusted to have wired it up.
  const descriptor: UnitsDescriptor = {
    topics: { "probe.topic": { alpha: "m", beta: "s" } },
    topicShapes: {
      "probe.topic": { nested: "ProbeNested", meta: "PayloadMeta" },
    },
    types: { ProbeNested: { gamma: "K" }, PayloadMeta: { source: "id" } },
  };

  it("expands a topic to its nested fields and drops the envelope", () => {
    const fields = topicFieldNames(descriptor, "probe.topic");
    expect([...(fields ?? [])].sort()).toEqual([
      "alpha",
      "beta",
      "gamma",
      "nested",
    ]);
  });

  it("says plainly when a topic has no descriptor at all", () => {
    expect(topicFieldNames(descriptor, "probe.unknown")).toBeNull();
  });

  it("counts a null-valued key as UNPOPULATED, which is the whole case", () => {
    const populated = collectPopulatedFields({
      alpha: 1,
      beta: null,
      nested: { gamma: 2 },
    });
    expect([...populated].sort()).toEqual(["alpha", "gamma", "nested"]);
  });

  it("sees a read through a property access and through a destructuring", () => {
    const names = dereferencedNames(
      codeOnly(
        "const { gamma } = payload.nested; const a = payload.alpha;",
        "probe.ts",
      ),
    );
    expect(names.has("alpha")).toBe(true);
    expect(names.has("gamma")).toBe(true);
    expect(names.has("nested")).toBe(true);
  });

  it("does NOT see a quoted index access, which is the shape it gives up on", () => {
    /*
     * Stated as a checked fact rather than left in the prose: `payload["beta"]`
     * needs a string, the stripper has already blanked it, and reading it off
     * the raw source instead would swallow every array of string literals.
     */
    const names = dereferencedNames(
      codeOnly('const b = payload["beta"];', "probe.ts"),
    );
    expect(names.has("beta")).toBe(false);
  });

  it("does not read a field name out of a comment, a string or a type", () => {
    const stripped = codeOnly(
      [
        "// payload.alpha used to be drawn here",
        'const topic = "probe.beta";',
        "interface Local { gamma?: number | null }",
        "const x = 1;",
      ].join("\n"),
      "probe.ts",
    );
    const names = dereferencedNames(stripped);
    expect(names.has("alpha")).toBe(false);
    expect(names.has("beta")).toBe(false);
    expect(names.has("gamma")).toBe(false);
  });

  it("survives an apostrophe in JSX text, where a bare state machine loses the rest of the file", () => {
    /*
     * The failure mode `uplink-boundary.test.ts` documents: a stripper that
     * desynchronises here goes quiet for the remainder of the file, and a quiet
     * scan reports success.
     */
    const stripped = codeOnly(
      "const a = <p>KSP won't save here</p>;\nconst b = payload.alpha;\n",
      "probe.tsx",
    );
    expect(dereferencedNames(stripped).has("alpha")).toBe(true);
  });
});

/**
 * Loads the debt module's exports as they stood at the ratchet base, without
 * touching the working tree. Same mechanism as `uplink-boundary.test.ts`:
 * transpile the git blob and import it as a `data:` URL, so there is no temp
 * file to clean up.
 */
async function loadDebtAt(
  base: RatchetBase,
  relPath: string,
): Promise<{ RENDER_GAP?: readonly string[] } | null> {
  const source = sourceAtRatchetBase(base, relPath);
  if (source === null) return null;
  const { code } = transformSync(source, { loader: "ts", format: "esm" });
  return await import(`data:text/javascript,${encodeURIComponent(code)}`);
}

/** Which entries `current` has that `previous` did not. */
function findRenderGapGrowth(
  previous: readonly string[],
  current: readonly string[],
): string[] {
  const known = new Set(previous);
  return current.filter((entry) => !known.has(entry));
}

describe("findRenderGapGrowth: shrink-only comparison logic (synthetic)", () => {
  it("flags an entry that was not there before", () => {
    expect(findRenderGapGrowth(["a#x"], ["a#x", "b#y"])).toEqual(["b#y"]);
  });

  it("does not flag a removal or an unchanged list", () => {
    expect(findRenderGapGrowth(["a#x", "b#y"], ["b#y"])).toEqual([]);
    expect(findRenderGapGrowth(["a#x"], ["a#x"])).toEqual([]);
  });
});

describe("render-fixture coverage: RENDER_GAP only ever shrinks", () => {
  it("gained no entry vs the base ref", async () => {
    const base = ratchetBaseRef();
    if (!base) return; // the checkout IS the base, so there is nothing to diff

    const relPath = relative(
      ROOT,
      join(
        dirname(fileURLToPath(import.meta.url)),
        "render-fixture-coverage.debt.ts",
      ),
    );
    const previous = await loadDebtAt(base, relPath);
    if (!previous) {
      /*
       * Genuine on the commit that seeds the list, and a lie afterwards. Which
       * of the two it is gets graded in one place for every list, by
       * `ratchet-base-ref.test.ts`, rather than by a warning here that vitest
       * would suppress on a passing test anyway.
       */
      return;
    }

    const growth = findRenderGapGrowth(previous.RENDER_GAP ?? [], RENDER_GAP);
    if (growth.length > 0) {
      throw new Error(
        `New RENDER_GAP entries vs ${base.ref}. This list may only be ` +
          "REMOVED from, as fixtures grow to carry the fields:\n" +
          growth.map((e) => `  ${e}`).join("\n") +
          "\n\nA newly found gap is not recorded here, it is fixed: add or " +
          "extend a fixture in that widget's __fixtures__ dir so the field is " +
          "carried, and look at the render. If the match was never a payload " +
          "read at all, it belongs in COINCIDENTAL instead, with the line that " +
          "earned it quoted.",
      );
    }
  });
});
