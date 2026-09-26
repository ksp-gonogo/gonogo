// @vitest-environment node
// Node realm rather than the package's jsdom default: this spawns biome.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Project, ts } from "ts-morph";
import { describe, expect, it } from "vitest";
import {
  REFUSAL_REASONS,
  type RefusalReason,
  transform,
} from "../../../scripts/codemods/early-return";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const BIOME = join(REPO_ROOT, "node_modules/.bin/biome");
const CODEMOD = join(REPO_ROOT, "scripts/codemods/early-return.ts");

/** Everything a fixture may reference without declaring it. */
const PRELUDE = `declare const flag: boolean;
declare const other: boolean;
declare const count: number;
declare const settings: { fallback: number };
declare function measure(): number;
`;

interface Converted {
  name: string;
  input: string;
  output: string;
  tsx?: boolean;
}

const CONVERTED: Converted[] = [
  {
    name: "block branches ending in an else",
    input: `export function bars(connected: boolean, pct: number | null) {
  let bars: number | null;
  if (connected === false) {
    bars = 0;
  } else if (pct !== null) {
    bars = Math.max(1, Math.ceil(pct * 4));
  } else {
    bars = null;
  }
  return bars;
}
`,
    output: `export function bars(connected: boolean, pct: number | null) {
  const resolveBars = (): number | null => {
    if (connected === false) return 0;
    if (pct !== null) return Math.max(1, Math.ceil(pct * 4));
    return null;
  };
  const bars = resolveBars();
  return bars;
}
`,
  },
  {
    name: "unbraced branches",
    input: `export function label() {
  let label: string;
  if (flag) label = "a";
  else if (other) label = "b";
  else label = "c";
  return label;
}
`,
    output: `export function label() {
  const resolveLabel = (): string => {
    if (flag) return "a";
    if (other) return "b";
    return "c";
  };
  const label = resolveLabel();
  return label;
}
`,
  },
  {
    name: "no final else, the literal initializer becomes the fallback",
    input: `export function tone() {
  let tone = "idle";
  if (flag) {
    tone = "ok";
  } else if (other) {
    tone = "warn";
  }
  return tone;
}
`,
    output: `export function tone() {
  const resolveTone = () => {
    if (flag) return "ok";
    if (other) return "warn";
    return "idle";
  };
  const tone = resolveTone();
  return tone;
}
`,
  },
  {
    name: "no final else, a const initializer moves across other statements",
    input: `const DEFAULT_WIDTH = 4;
export function width() {
  let width = DEFAULT_WIDTH;
  const doubled = count * 2;
  if (flag) {
    width = doubled;
  } else if (other) {
    width = 1;
  }
  return width;
}
`,
    output: `const DEFAULT_WIDTH = 4;
export function width() {
  const doubled = count * 2;
  const resolveWidth = () => {
    if (flag) return doubled;
    if (other) return 1;
    return DEFAULT_WIDTH;
  };
  const width = resolveWidth();
  return width;
}
`,
  },
  {
    name: "no final else, an effect-free initializer directly above the chain",
    input: `export function limit() {
  let limit = settings.fallback;
  if (flag) {
    limit = 1;
  } else if (other) {
    limit = 2;
  }
  return limit;
}
`,
    output: `export function limit() {
  const resolveLimit = () => {
    if (flag) return 1;
    if (other) return 2;
    return settings.fallback;
  };
  const limit = resolveLimit();
  return limit;
}
`,
  },
  {
    name: "a final else makes an effect-free initializer dead",
    input: `export function size() {
  let size = 0;
  if (flag) {
    size = 1;
  } else if (other) {
    size = 2;
  } else {
    size = 3;
  }
  return size;
}
`,
    output: `export function size() {
  const resolveSize = () => {
    if (flag) return 1;
    if (other) return 2;
    return 3;
  };
  const size = resolveSize();
  return size;
}
`,
  },
  {
    name: "a declared literal union survives as the helper's return type",
    input: `type Mode = "off" | "low" | "high";
export function mode(): Mode {
  let mode: Mode;
  if (count > 10) {
    mode = "high";
  } else if (count > 0) {
    mode = "low";
  } else {
    mode = "off";
  }
  return mode;
}
`,
    output: `type Mode = "off" | "low" | "high";
export function mode(): Mode {
  const resolveMode = (): Mode => {
    if (count > 10) return "high";
    if (count > 0) return "low";
    return "off";
  };
  const mode = resolveMode();
  return mode;
}
`,
  },
  {
    name: "comments before a branch's assignment and on the declaration move with them",
    input: `export function level() {
  /** The level an operator reads. */
  let level: number;
  if (flag) {
    // Saturated.
    level = 3;
  } else if (other) {
    level = 2;
  } else {
    /* Nothing to report. */
    level = 0;
  }
  return level;
}
`,
    output: `export function level() {
  /** The level an operator reads. */
  const resolveLevel = (): number => {
    // Saturated.
    if (flag) return 3;
    if (other) return 2;
    /* Nothing to report. */
    return 0;
  };
  const level = resolveLevel();
  return level;
}
`,
  },
  {
    name: "a taken helper name gets a suffix",
    input: `const resolveState = 1;
export function state() {
  let state: number;
  if (flag) {
    state = resolveState;
  } else if (other) {
    state = 2;
  } else {
    state = 0;
  }
  return state;
}
`,
    output: `const resolveState = 1;
export function state() {
  const resolveState2 = (): number => {
    if (flag) return resolveState;
    if (other) return 2;
    return 0;
  };
  const state = resolveState2();
  return state;
}
`,
  },
  {
    name: "two chains in one component, JSX values",
    tsx: true,
    input: `export function Glyph() {
  let icon: JSX.Element;
  if (flag) {
    icon = <b>on</b>;
  } else if (other) {
    icon = <i>mid</i>;
  } else {
    icon = <span>off</span>;
  }
  let tone = "grey";
  if (flag) {
    tone = "green";
  } else if (other) {
    tone = "amber";
  }
  return <div className={tone}>{icon}</div>;
}
`,
    output: `export function Glyph() {
  const resolveIcon = (): JSX.Element => {
    if (flag) return <b>on</b>;
    if (other) return <i>mid</i>;
    return <span>off</span>;
  };
  const icon = resolveIcon();
  const resolveTone = () => {
    if (flag) return "green";
    if (other) return "amber";
    return "grey";
  };
  const tone = resolveTone();
  return <div className={tone}>{icon}</div>;
}
`,
  },
];

const REFUSED: {
  reason: RefusalReason;
  input: string;
  name?: string;
  tsx?: boolean;
}[] = [
  {
    reason: "branch-has-multiple-statements",
    input: `export function f() {
  let n: number;
  if (flag) {
    n = 1;
    console.log(n);
  } else if (other) {
    n = 2;
  } else {
    n = 3;
  }
  return n;
}
`,
  },
  {
    reason: "branch-not-assignment",
    input: `export function f(log: (m: string) => void) {
  if (flag) log("a");
  else if (other) log("b");
}
`,
  },
  {
    reason: "compound-assignment",
    input: `export function f() {
  let n = 0;
  if (flag) {
    n += 1;
  } else if (other) {
    n = 2;
  }
  return n;
}
`,
  },
  {
    reason: "target-not-identifier",
    input: `export function f(box: { n: number }) {
  if (flag) {
    box.n = 1;
  } else if (other) {
    box.n = 2;
  }
  return box;
}
`,
  },
  {
    reason: "different-targets",
    input: `export function f() {
  let a = 0;
  let b = 0;
  if (flag) {
    a = 1;
  } else if (other) {
    b = 1;
  }
  return a + b;
}
`,
  },
  {
    reason: "target-not-local-let",
    input: `export function f(n: number) {
  if (flag) {
    n = 1;
  } else if (other) {
    n = 2;
  }
  return n;
}
`,
  },
  {
    reason: "multiple-declarators",
    input: `export function f() {
  let n = 0,
    m = 1;
  if (flag) {
    n = 1;
  } else if (other) {
    n = 2;
  }
  return n + m;
}
`,
  },
  {
    reason: "declaration-shares-line",
    input: `export function f() {
  let n = 0; // Starts empty.
  if (flag) {
    n = 1;
  } else if (other) {
    n = 2;
  }
  return n;
}
`,
  },
  {
    reason: "declared-in-other-block",
    input: `export function f() {
  let n = 0;
  if (count > 1) {
    if (flag) {
      n = 1;
    } else if (other) {
      n = 2;
    }
  }
  return n;
}
`,
  },
  {
    reason: "exported-declaration",
    input: `export let n = 0;
if (flag) {
  n = 1;
} else if (other) {
  n = 2;
}
`,
  },
  {
    reason: "target-used-in-chain",
    input: `export function f() {
  let n = count;
  if (flag) {
    n = n * 2;
  } else if (other) {
    n = 2;
  }
  return n;
}
`,
  },
  {
    reason: "target-used-before-chain",
    input: `export function f() {
  let n = 0;
  const seen = n;
  if (flag) {
    n = 1;
  } else if (other) {
    n = 2;
  }
  return n + seen;
}
`,
  },
  {
    reason: "target-reassigned-after-chain",
    input: `export function f() {
  let n = 0;
  if (flag) {
    n = 1;
  } else if (other) {
    n = 2;
  }
  n = n + 1;
  return n;
}
`,
  },
  {
    reason: "side-effect-in-chain",
    input: `export function f() {
  let i = 0;
  let n = 0;
  if (flag) {
    n = i++;
  } else if (other) {
    n = 2;
  }
  return n + i;
}
`,
  },
  {
    reason: "await-or-yield-in-chain",
    input: `export async function f(p: Promise<number>) {
  let n = 0;
  if (flag) {
    n = await p;
  } else if (other) {
    n = 2;
  }
  return n;
}
`,
  },
  {
    reason: "closure-over-mutated-state",
    input: `export function f() {
  let source: number | null = null;
  if (count > 0) source = count;
  let n: number;
  if (source !== null) {
    n = source;
  } else if (other) {
    n = 2;
  } else {
    n = 0;
  }
  return n;
}
`,
  },
  {
    reason: "missing-else-without-initializer",
    input: `export function f() {
  let n: number | undefined;
  if (flag) {
    n = 1;
  } else if (other) {
    n = 2;
  }
  return n;
}
`,
  },
  {
    reason: "initializer-not-movable",
    input: `export function f() {
  let n = settings.fallback;
  settings.fallback = 9;
  if (flag) {
    n = 1;
  } else if (other) {
    n = 2;
  }
  return n;
}
`,
  },
  {
    reason: "initializer-has-effects",
    input: `export function f() {
  let n = measure();
  if (flag) {
    n = 1;
  } else if (other) {
    n = 2;
  } else {
    n = 3;
  }
  return n;
}
`,
  },
  {
    reason: "untyped-declaration",
    input: `export function f() {
  let n;
  if (flag) {
    n = 1;
  } else if (other) {
    n = 2;
  } else {
    n = 3;
  }
  return n;
}
`,
  },
  {
    reason: "comment-position",
    input: `export function f() {
  let n: number;
  if (flag) {
    n = 1; // Trailing.
  } else if (other) {
    n = 2;
  } else {
    n = 3;
  }
  return n;
}
`,
  },
  {
    name: "a comment inside a condition",
    reason: "comment-position",
    input: `export function f() {
  let n: number;
  if (flag /* hot */) {
    n = 1;
  } else if (other) {
    n = 2;
  } else {
    n = 3;
  }
  return n;
}
`,
  },
  {
    name: "a comment between a closing brace and else",
    reason: "comment-position",
    input: `export function f() {
  let n: number;
  if (flag) {
    n = 1;
  } // Hot.
  else if (other) {
    n = 2;
  } else {
    n = 3;
  }
  return n;
}
`,
  },
  {
    name: "a comment inside a JSX value",
    reason: "comment-position",
    tsx: true,
    input: `export function F() {
  let n: JSX.Element;
  if (flag) {
    n = <b>{/* hot */}on</b>;
  } else if (other) {
    n = <i>mid</i>;
  } else {
    n = <span>off</span>;
  }
  return n;
}
`,
  },
  {
    name: "a read through a shorthand property before the chain",
    reason: "target-used-before-chain",
    input: `export function f() {
  let n = 0;
  const box = { n };
  if (flag) {
    n = 1;
  } else if (other) {
    n = 2;
  }
  return n + box.n;
}
`,
  },
  {
    name: "a closure over mutated state read through a shorthand property",
    reason: "closure-over-mutated-state",
    input: `export function f() {
  let seed = 0;
  if (count > 0) seed = count;
  let box: { seed: number };
  if (flag) {
    box = { seed };
  } else if (other) {
    box = { seed: 1 };
  } else {
    box = { seed: 2 };
  }
  return box;
}
`,
  },
];

const fileOf = (fixture: { tsx?: boolean }) =>
  fixture.tsx ? "fixture.tsx" : "fixture.ts";

function diagnostics(fileName: string, text: string) {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      strict: true,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.Preserve,
      noUnusedLocals: true,
    },
  });
  if (fileName.endsWith(".tsx")) {
    project.createSourceFile(
      "jsx.d.ts",
      "declare namespace JSX { interface Element {} interface IntrinsicElements { [tag: string]: unknown } }",
    );
  }
  project.createSourceFile(fileName, PRELUDE + text);
  return project
    .getPreEmitDiagnostics()
    .map((d) =>
      ts.flattenDiagnosticMessageText(d.compilerObject.messageText, "\n"),
    );
}

/**
 * `biome check` over the text as a real file under the repo's config. Biome's
 * stdin mode exits 1 on clean input, so it cannot answer the question.
 */
function biomeCheck(fileName: string, text: string) {
  const dir = mkdtempSync(join(tmpdir(), "early-return-"));
  try {
    const file = join(dir, fileName);
    writeFileSync(file, text);
    return spawnSync(
      BIOME,
      ["check", `--config-path=${join(REPO_ROOT, "biome.json")}`, file],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the early-return codemod converts the assignment-chain shape", () => {
  for (const fixture of CONVERTED) {
    const fileName = fixture.tsx ? "fixture.tsx" : "fixture.ts";

    it(fixture.name, () => {
      const { sites, output } = transform(fileName, fixture.input);
      expect(sites.map((s) => s.verdict)).toEqual(sites.map(() => "converted"));
      expect(sites.length).toBeGreaterThan(0);
      expect(output).toBe(fixture.output);
    });

    it(`${fixture.name}: input and output both typecheck`, () => {
      const { output } = transform(fileName, fixture.input);
      expect(diagnostics(fileName, fixture.input)).toEqual([]);
      expect(diagnostics(fileName, output)).toEqual([]);
    });

    it(`${fixture.name}: output is biome-clean`, () => {
      const check = biomeCheck(
        fileName,
        transform(fileName, fixture.input).output,
      );
      expect(check.status, check.stdout + check.stderr).toBe(0);
      expect(check.stdout + check.stderr).toContain("Checked 1 file");
    });
  }
});

describe("the early-return codemod refuses every unsafe chain and leaves it untouched", () => {
  for (const fixture of REFUSED) {
    it(fixture.name ?? fixture.reason, () => {
      const { sites, output } = transform(fileOf(fixture), fixture.input);
      expect(sites).toEqual([
        expect.objectContaining({
          verdict: "refused",
          reason: fixture.reason,
        }),
      ]);
      expect(output).toBe(fixture.input);
    });

    it(`${fixture.name ?? fixture.reason}: the fixture is valid TypeScript`, () => {
      expect(diagnostics(fileOf(fixture), fixture.input)).toEqual([]);
    });
  }

  it("names every refusal reason in a fixture", () => {
    expect([...new Set(REFUSED.map((f) => f.reason))].sort()).toEqual(
      [...REFUSAL_REASONS].sort(),
    );
  });

  it("reports nothing for a plain if/else or an early-return chain", () => {
    const input = `export function f() {
  let n: number;
  if (flag) {
    n = 1;
  } else {
    n = 2;
  }
  if (other) return n;
  return 0;
}
`;
    expect(transform("fixture.ts", input)).toEqual({
      sites: [],
      output: input,
    });
  });
});

describe("the early-return codemod's command line", () => {
  const MULTILINE = `export function body(pending: boolean, label: string) {
  let body: string = label;
  if (pending) {
    body = [
      "waiting",
      label,
    ].join(" ");
  } else if (flag) {
    body = "done";
  }
  return body;
}
`;
  const REFUSED_TEXT = REFUSED[0].input;

  function withTree(run: (dir: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), "early-return-cli-"));
    try {
      writeFileSync(join(dir, "multiline.ts"), MULTILINE);
      writeFileSync(join(dir, "refused.ts"), REFUSED_TEXT);
      writeFileSync(join(dir, "unlisted.ts"), CONVERTED[0].input);
      run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const cli = (dir: string, args: string[]) =>
    spawnSync("node", ["--no-warnings", CODEMOD, ...args], {
      cwd: dir,
      encoding: "utf8",
    });

  it("lists every site with its verdict and writes nothing without --write", () => {
    withTree((dir) => {
      const run = cli(dir, ["multiline.ts", "refused.ts"]);
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toContain("multiline.ts:3:3 converted body");
      expect(run.stdout).toContain(
        "refused.ts:3:3 refused branch-has-multiple-statements",
      );
      expect(run.stdout).toMatch(/\n\s+1 {2}converted\n/);
      expect(readFileSync(join(dir, "multiline.ts"), "utf8")).toBe(MULTILINE);
    });
  });

  it("writes only the paths it was given, formatted and typechecking", () => {
    withTree((dir) => {
      const run = cli(dir, ["multiline.ts", "refused.ts", "--write"]);
      expect(run.status, run.stderr).toBe(0);
      const written = readFileSync(join(dir, "multiline.ts"), "utf8");
      expect(written).not.toBe(MULTILINE);
      expect(written).toContain("const body = resolveBody();");
      expect(diagnostics("multiline.ts", written)).toEqual([]);
      const check = biomeCheck("multiline.ts", written);
      expect(check.status, check.stdout + check.stderr).toBe(0);
      expect(readFileSync(join(dir, "refused.ts"), "utf8")).toBe(REFUSED_TEXT);
      expect(readFileSync(join(dir, "unlisted.ts"), "utf8")).toBe(
        CONVERTED[0].input,
      );
    });
  });
});
