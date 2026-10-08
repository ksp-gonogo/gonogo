import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createIndexReader,
  type ReadsIndex,
  SDK_PACKAGE,
} from "./index-reader";
import { loadTypeScript, type TypeScript } from "./program";

const PACKAGES = [
  {
    name: SDK_PACKAGE,
    declarations: [
      "index.d.ts",
      "frames/index.d.ts",
      "media/index.d.ts",
      "registry/index.d.ts",
      "spine/index.d.ts",
    ],
  },
  {
    name: "@ksp-gonogo/ui-kit",
    declarations: ["index.d.ts", "guards.d.ts", "gridUnits.d.ts"],
  },
];

let ts: TypeScript;
beforeAll(async () => {
  ts = await loadTypeScript(import.meta.dirname);
});

function distOf(name: string): string {
  let dir = import.meta.dirname;
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(candidate)) return join(realpathSync(candidate), "dist");
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`${name} is not installed`);
    dir = parent;
  }
}

function indexOf(name: string): ReadsIndex {
  const { index, problem } = createIndexReader().lookup(
    name,
    join(import.meta.dirname, "x.ts"),
  );
  if (!index) throw new Error(`${name} ships no reads index: ${problem}`);
  return index;
}

/** Every hook a package's declarations export. */
function exportedHooks(name: string, declarations: string[]): string[] {
  const dist = distOf(name);
  const roots = declarations.map((file) => join(dist, file));
  const program = ts.createProgram({
    rootNames: roots,
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      noEmit: true,
      types: [],
    },
  });
  const checker = program.getTypeChecker();
  const names = new Set<string>();
  for (const root of roots) {
    const file = program.getSourceFile(root);
    const symbol = file && checker.getSymbolAtLocation(file);
    if (!symbol) continue;
    for (const exported of checker.getExportsOfModule(symbol)) {
      if (!/^use[A-Z]/.test(exported.name)) continue;
      const target =
        exported.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(exported)
          : exported;
      const type = checker.getTypeOfSymbol(target);
      if (type.getCallSignatures().length > 0) names.add(exported.name);
    }
  }
  return [...names].sort();
}

const missingFrom = (hooks: string[], index: ReadsIndex) =>
  hooks.filter((hook) => index.entries[hook] === undefined);

describe.each(PACKAGES)("the reads index $name ships", ({
  name,
  declarations,
}) => {
  it("is built beside dist and exported by the package", () => {
    expect(existsSync(join(distOf(name), "reads-index.json"))).toBe(true);
    expect(indexOf(name).package).toBe(name);
  });

  it("lists every exported hook", () => {
    const hooks = exportedHooks(name, declarations);
    expect(hooks.length).toBeGreaterThan(0);
    expect(missingFrom(hooks, indexOf(name))).toEqual([]);
  });

  it("would notice a hook that was left out", () => {
    const hooks = exportedHooks(name, declarations);
    const index = indexOf(name);
    const { [hooks[0]]: _dropped, ...rest } = index.entries;
    expect(missingFrom(hooks, { ...index, entries: rest })).toEqual([hooks[0]]);
  });

  it("has nothing in it the scan could not name", () => {
    const unresolved = Object.entries(indexOf(name).entries).flatMap(
      ([hook, entry]) => entry.unresolved.map((line) => `${hook}: ${line}`),
    );
    expect(unresolved).toEqual([]);
  });
});

describe("what the sdk's index says about its own hooks", () => {
  it("names the argument each primitive reader takes", () => {
    const { entries } = indexOf(SDK_PACKAGE);
    expect(entries.useTelemetry.arguments).toEqual([
      { index: 0, kind: "topic" },
    ]);
    expect(entries.useStream.arguments).toEqual([{ index: 0, kind: "topic" }]);
    expect(entries.useLatestValue.arguments).toEqual([
      { index: 0, kind: "topic" },
    ]);
    expect(entries.useCommand.arguments).toEqual([
      { index: 0, kind: "command" },
    ]);
    expect(entries.useProcessor.arguments).toEqual([
      { index: 0, kind: "processor" },
    ]);
  });

  it("lists the Topics a hook reads without being handed one", () => {
    const { entries } = indexOf(SDK_PACKAGE);
    expect(entries.useModSettings.families).toEqual(["settings.<uplinkId>"]);
    expect(entries.useOwnCraftVantage.reads).toEqual(["vessel.orbit"]);
    expect(entries.useRouteCommands.reads).toEqual([
      "comms.delay",
      "system.uplink.pending",
    ]);
  });

  it("lists the reads the framework makes for a widget", () => {
    expect(indexOf(SDK_PACKAGE).frameworkReads).toMatchObject({
      useCommand: expect.arrayContaining(["comms.delay"]),
      RequiresGuard: expect.arrayContaining(["system.uplinkHealth"]),
    });
  });

  it("leaves the framework's own reads out of the kit's components", () => {
    const { entries } = indexOf("@ksp-gonogo/ui-kit");
    for (const component of ["Section", "LockScope", "WidgetBody"]) {
      expect(entries[component].reads).toEqual([]);
    }
  });
});
