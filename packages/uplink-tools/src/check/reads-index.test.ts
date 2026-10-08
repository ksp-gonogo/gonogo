import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createIndexReader, type ReadsIndex } from "./index-reader";
import {
  createClientProgram,
  loadTypeScript,
  type TypeScript,
} from "./program";
import { buildReadsIndex } from "./reads-index-build";
import { declarationRules } from "./rules/declarations";
import { scanClient } from "./scan";

let ts: TypeScript;
beforeAll(async () => {
  ts = await loadTypeScript(import.meta.dirname);
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "Bundler",
    jsx: "react-jsx",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  },
  include: ["src"],
});

function put(root: string, files: Record<string, string>) {
  for (const [name, text] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
}

const workspace = () => {
  const root = mkdtempSync(join(tmpdir(), "reads-index-test-"));
  dirs.push(root);
  return root;
};

/** An installed package whose dist carries declarations and, optionally, an index. */
function installPackage(
  root: string,
  name: string,
  declarations: string,
  index?: ReadsIndex,
  exportIndex = true,
) {
  const base = `node_modules/${name}`;
  put(root, {
    [`${base}/package.json`]: JSON.stringify({
      name,
      type: "module",
      exports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
        ...(exportIndex
          ? { "./reads-index.json": "./dist/reads-index.json" }
          : {}),
      },
    }),
    [`${base}/dist/index.d.ts`]: declarations,
    [`${base}/dist/index.js`]: "",
    ...(index
      ? { [`${base}/dist/reads-index.json`]: JSON.stringify(index) }
      : {}),
  });
}

const entry = (over: Partial<ReadsIndex["entries"][string]> = {}) => ({
  reads: [],
  families: [],
  commands: [],
  arguments: [],
  unresolved: [],
  ...over,
});

const indexOf = (
  entries: ReadsIndex["entries"],
  frameworkReads: ReadsIndex["frameworkReads"] = {},
): ReadsIndex => ({
  version: 1,
  package: "@ksp-gonogo/fake-kit",
  frameworkReads,
  entries,
});

const KIT_DECLARATIONS = `
export declare function useAltitude(): unknown;
export declare function useReadOf(topic: string): unknown;
export declare function useLaunch(): unknown;
export declare function useForgotten(): unknown;
export declare function Gauge(props: object): null;
export declare function registerComponent(def: object): void;
export declare function useCommand(command: string): unknown;
export declare function useStream(topic: string): unknown;
`;

const clientFor = (
  root: string,
  body: string,
  imports = "useAltitude, useReadOf, useLaunch, useForgotten, Gauge, registerComponent",
) => {
  put(root, {
    "client/tsconfig.json": TSCONFIG,
    "client/src/w.tsx": `
import { ${imports} } from "@ksp-gonogo/fake-kit";
function Widget(props: { topic: string }) {
${body}
  return null;
}
registerComponent({ id: "w", component: Widget });
`,
  });
  const client = join(root, "client");
  return scanClient(ts, createClientProgram(ts, client), {
    clientDir: client,
    indexes: createIndexReader(),
  });
};

const readsOf = (scan: ReturnType<typeof clientFor>) =>
  scan.widgets[0].reads.map((r) => r.id ?? r.family).sort();

describe("a client reading a published package through its index", () => {
  it("takes the reads, commands and families an entry lists", () => {
    const root = workspace();
    installPackage(
      root,
      "@ksp-gonogo/fake-kit",
      KIT_DECLARATIONS,
      indexOf({
        useAltitude: entry({
          reads: ["vessel.flight"],
          families: ["fleet.<vessel>.contact"],
          commands: ["vessel.control.setSas"],
        }),
      }),
    );
    const scan = clientFor(root, "useAltitude();");
    expect(readsOf(scan)).toEqual(["fleet.<vessel>.contact", "vessel.flight"]);
    expect(scan.widgets[0].commands.map((c) => c.id)).toEqual([
      "vessel.control.setSas",
    ]);
    expect(scan.indexMissing).toEqual([]);
  });

  it("reads the Topic the caller passes where the entry forwards a parameter", () => {
    const root = workspace();
    installPackage(
      root,
      "@ksp-gonogo/fake-kit",
      KIT_DECLARATIONS,
      indexOf({
        useReadOf: entry({ arguments: [{ index: 0, kind: "topic" }] }),
      }),
    );
    const scan = clientFor(root, `useReadOf("vessel.orbit");`);
    expect(readsOf(scan)).toEqual(["vessel.orbit"]);
  });

  it("reports an argument it cannot name rather than guessing", () => {
    const root = workspace();
    installPackage(
      root,
      "@ksp-gonogo/fake-kit",
      KIT_DECLARATIONS,
      indexOf({
        useReadOf: entry({ arguments: [{ index: 0, kind: "topic" }] }),
      }),
    );
    const scan = clientFor(root, "useReadOf(props.topic);");
    expect(scan.widgets[0].unresolved.map((u) => u.call)).toEqual([
      "useReadOf",
    ]);
  });

  it("leaves out what a framework component the sdk names reads for itself, and keeps what the widget reads", () => {
    const root = workspace();
    installPackage(root, "@ksp-gonogo/fake-kit", KIT_DECLARATIONS, indexOf({}));
    put(root, {
      "client/tsconfig.json": TSCONFIG,
      "client/src/w.tsx": `
import { useStream, registerComponent } from "@ksp-gonogo/fake-kit";
function Guard() {
  useStream("system.uplinkHealth");
  return null;
}
function Widget() {
  useStream("system.uplinkHealth");
  const guard = <Guard />;
  void guard;
  return null;
}
registerComponent({ id: "w", component: Widget });
`,
    });
    const client = join(root, "client");
    const scan = scanClient(ts, createClientProgram(ts, client), {
      clientDir: client,
      indexes: createIndexReader(),
      frameworkReads: { Guard: ["system.uplinkHealth"] },
    });
    expect(scan.widgets[0].reads.map((r) => r.line)).toEqual([8]);
  });

  it("names a hook the index does not describe, and a directive answers it", () => {
    const root = workspace();
    installPackage(
      root,
      "@ksp-gonogo/fake-kit",
      KIT_DECLARATIONS,
      indexOf({ useAltitude: entry() }),
    );
    const missing = clientFor(root, "useForgotten();");
    expect(missing.indexMissing).toMatchObject([
      { name: "useForgotten", specifier: "@ksp-gonogo/fake-kit" },
    ]);
    const findings = declarationRules.flatMap((rule) =>
      rule.check({
        clientDir: join(root, "client"),
        scan: missing,
        dynamicPrefixes: [],
      }),
    );
    const finding = findings.find(
      (f) => f.rule === "declarations/index-missing",
    );
    expect(finding).toMatchObject({ severity: "error", fixable: false });
    expect(finding?.message).toContain("useForgotten");

    const answered = clientFor(
      root,
      "// gonogo:reads vessel.flight\n  useForgotten();",
    );
    expect(answered.indexMissing).toEqual([]);
    expect(readsOf(answered)).toEqual(["vessel.flight"]);
  });

  it("takes `none` as the author's statement that a call reads nothing", () => {
    const root = workspace();
    installPackage(root, "@ksp-gonogo/fake-kit", KIT_DECLARATIONS, indexOf({}));
    const scan = clientFor(root, "// gonogo:reads none\n  useForgotten();");
    expect(scan.indexMissing).toEqual([]);
    expect(scan.widgets[0].reads).toEqual([]);
    expect(scan.widgets[0].unresolved).toEqual([]);
  });

  it("does not ask a component to be indexed, only a hook", () => {
    const root = workspace();
    installPackage(root, "@ksp-gonogo/fake-kit", KIT_DECLARATIONS, indexOf({}));
    const scan = clientFor(root, "const element = <Gauge />;\n  void element;");
    expect(scan.indexMissing).toEqual([]);
  });

  it("says why when the installed package ships no index", () => {
    const root = workspace();
    installPackage(
      root,
      "@ksp-gonogo/fake-kit",
      KIT_DECLARATIONS,
      undefined,
      false,
    );
    const scan = clientFor(root, "useAltitude();");
    expect(scan.indexMissing[0].reason).toContain(
      "does not export ./reads-index.json",
    );
  });

  it("says why when the index file was never built", () => {
    const root = workspace();
    installPackage(root, "@ksp-gonogo/fake-kit", KIT_DECLARATIONS);
    const scan = clientFor(root, "useAltitude();");
    expect(scan.indexMissing[0].reason).toContain("has not been built");
  });

  it("does not look for an index for a package that is not part of Gonogo", () => {
    const root = workspace();
    installPackage(root, "some-other-kit", KIT_DECLARATIONS);
    put(root, {
      "client/tsconfig.json": TSCONFIG,
      "client/src/w.tsx": `
import { useAltitude, registerComponent } from "some-other-kit";
function Widget() { useAltitude(); return null; }
registerComponent({ id: "w", component: Widget });
`,
    });
    const client = join(root, "client");
    const scan = scanClient(ts, createClientProgram(ts, client), {
      clientDir: client,
      indexes: createIndexReader(),
    });
    expect(scan.indexMissing).toEqual([]);
  });
});

describe("building an index from a package's source", () => {
  const SOURCE = {
    "tsconfig.json": TSCONFIG,
    "src/api.ts": `
export declare function useStream(topic: string): unknown;
export declare function useCommand(command: string): unknown;
export declare function getHost(): { useThing(): unknown };
`,
    "src/index.ts": `
import { getHost, useCommand, useStream } from "./api";
export { useStream, useCommand } from "./api";
export const FRAMEWORK_READS = { useSend: ["comms.delay"] } as const;

export function useFlight() {
  return useStream("vessel.flight");
}

export function useReadOf(topic: string) {
  return useStream(topic);
}

export function useWrapped(topic: string) {
  const first = useReadOf("vessel.orbit");
  const second = useReadOf(topic);
  return [first, second];
}

export function useSend() {
  useStream("comms.delay");
  return useCommand("vessel.control.setSas");
}

export function useFamily(id: string) {
  return useStream(\`fleet.\${id}.contact\`);
}

export function useQuiet() {
  return 1;
}

export function Panel() {
  useFlight();
  return null;
}
`,
  };

  const build = (
    files: Record<string, string>,
    frameworkReadsExport: string | undefined = "FRAMEWORK_READS",
  ) => {
    const root = workspace();
    put(root, files);
    const program = createClientProgram(ts, root);
    return buildReadsIndex(ts, program, {
      packageDir: root,
      packageName: "@ksp-gonogo/fake-kit",
      entries: ["src/index.ts"],
      frameworkReadsExport,
    });
  };

  it("lists the reads of every exported function and component", () => {
    const { index, problems } = build(SOURCE);
    expect(problems).toEqual([]);
    expect(index.frameworkReads).toEqual({ useSend: ["comms.delay"] });
    expect(index.entries.useFlight.reads).toEqual(["vessel.flight"]);
    expect(index.entries.Panel.reads).toEqual(["vessel.flight"]);
    expect(index.entries.useFamily.families).toEqual(["fleet.<id>.contact"]);
    expect(index.entries.useQuiet).toEqual(entry());
  });

  it("records a parameter that goes on to a read, through a helper too", () => {
    const { index } = build(SOURCE);
    expect(index.entries.useReadOf.arguments).toEqual([
      { index: 0, kind: "topic" },
    ]);
    expect(index.entries.useWrapped.reads).toEqual(["vessel.orbit"]);
  });

  it("takes the arguments of the primitive reads from the scanner's own table", () => {
    const { index } = build(SOURCE);
    expect(index.entries.useStream.arguments).toEqual([
      { index: 0, kind: "topic" },
    ]);
    expect(index.entries.useCommand.arguments).toEqual([
      { index: 0, kind: "command" },
    ]);
  });

  it("drops what the package lists as the framework's own reads, and keeps the command", () => {
    const { index } = build(SOURCE);
    expect(index.entries.useSend.reads).toEqual([]);
    expect(index.entries.useSend.commands).toEqual(["vessel.control.setSas"]);
  });

  it("refuses to write an index with a read it cannot name", () => {
    const { problems } = build({
      ...SOURCE,
      "src/index.ts": `
import { useStream } from "./api";
export const FRAMEWORK_READS = {} as const;
export function useHidden(props: { topic: string }) {
  return useStream(props.topic);
}
`,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("useHidden");
  });

  it("treats a hook that reaches the host as unknown until its author says what it reads", () => {
    const hook = (comment: string) => ({
      ...SOURCE,
      "src/index.ts": `
import { getHost } from "./api";
export const FRAMEWORK_READS = {} as const;
export function useThing() {
${comment}
  return getHost().useThing();
}
`,
    });
    expect(build(hook("")).problems).toHaveLength(1);
    expect(build(hook("  // gonogo:reads none")).problems).toEqual([]);
    const named = build(hook("  // gonogo:reads vessel.flight"));
    expect(named.problems).toEqual([]);
    expect(named.index.entries.useThing.reads).toEqual(["vessel.flight"]);
  });

  it("does not treat a function that is not a hook as opaque", () => {
    const { problems, index } = build({
      ...SOURCE,
      "src/index.ts": `
import { getHost } from "./api";
export const FRAMEWORK_READS = {} as const;
export function installThing() {
  return getHost();
}
`,
    });
    expect(problems).toEqual([]);
    expect(index.entries.installThing).toEqual(entry());
  });

  it("indexes a hook that is a value, such as a store, from its initializer", () => {
    const { index, problems } = build({
      ...SOURCE,
      "src/index.ts": `
import { useStream } from "./api";
export const FRAMEWORK_READS = {} as const;
declare function makeStore(init: () => unknown): () => unknown;
export const useStore = makeStore(() => useStream("vessel.flight"));
`,
    });
    expect(problems).toEqual([]);
    expect(index.entries.useStore.reads).toEqual(["vessel.flight"]);
  });

  it("refuses a package whose framework reads are not a literal object", () => {
    expect(() =>
      build({
        ...SOURCE,
        "src/index.ts": `export const FRAMEWORK_READS = Object.freeze({});`,
      }),
    ).toThrow(/literal object/);
  });
});

describe("an index built by one package and read by another", () => {
  it("round-trips through the file the build writes", () => {
    const root = workspace();
    put(root, {
      "kit/tsconfig.json": TSCONFIG,
      "kit/src/index.ts": `
import { useStream } from "./stream";
export const FRAMEWORK_READS = {} as const;
export function useAltitude() {
  return useStream("vessel.flight");
}
`,
      "kit/src/stream.ts":
        "export declare function useStream(topic: string): unknown;",
    });
    const kitDir = join(root, "kit");
    const { index } = buildReadsIndex(ts, createClientProgram(ts, kitDir), {
      packageDir: kitDir,
      packageName: "@ksp-gonogo/fake-kit",
      entries: ["src/index.ts"],
      frameworkReadsExport: "FRAMEWORK_READS",
    });
    installPackage(root, "@ksp-gonogo/fake-kit", KIT_DECLARATIONS, index);
    const scan = clientFor(root, "useAltitude();");
    expect(readsOf(scan)).toEqual(["vessel.flight"]);
  });
});
