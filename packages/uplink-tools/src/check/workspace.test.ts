import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createIndexReader } from "./index-reader";
import {
  createClientProgram,
  loadTypeScript,
  type TypeScript,
} from "./program";
import { scanClient } from "./scan";
import { workspaceSourcePaths } from "./workspace";

let ts: TypeScript;
beforeAll(async () => {
  ts = await loadTypeScript(import.meta.dirname);
});

const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function put(root: string, files: Record<string, string>) {
  for (const [name, text] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
}

const json = (value: unknown) => JSON.stringify(value);

const TSCONFIG = json({
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

const KIT_INDEX = {
  version: 1,
  package: "@ksp-gonogo/kit",
  frameworkReads: {},
  entries: {
    useKit: {
      reads: ["kit.topic"],
      families: [],
      commands: [],
      arguments: [],
      unresolved: [],
    },
  },
};

/**
 * A pnpm workspace shaped like gonogo's: private `core` and `ui` whose exports
 * name built declarations, a published `kit` with a reads index, and a client.
 * `marker` leaves out `core`, which is what makes a workspace gonogo itself.
 */
function makeWorkspace({ marker = true }: { marker?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "workspace-walk-"));
  roots.push(root);
  put(root, {
    "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n  - 'mod/*/client'\n",
    "packages/kit/package.json": json({
      name: "@ksp-gonogo/kit",
      exports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
        "./reads-index.json": "./dist/reads-index.json",
      },
    }),
    "packages/kit/dist/index.d.ts":
      "export declare function useKit(): unknown;",
    "packages/kit/dist/reads-index.json": json(KIT_INDEX),
    "packages/ui/package.json": json({
      name: "@ksp-gonogo/ui",
      private: true,
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
    }),
    "packages/ui/src/index.ts": `export { useKit } from "@ksp-gonogo/kit";`,
    "packages/ui/dist/index.d.ts": `export { useKit } from "@ksp-gonogo/kit";`,
    "packages/components/package.json": json({
      name: "@ksp-gonogo/components",
      private: true,
    }),
    "packages/components/tsconfig.json": TSCONFIG,
  });
  if (marker) {
    put(root, {
      "packages/core/package.json": json({
        name: "@ksp-gonogo/core",
        private: true,
        exports: {
          ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
          "./test": { types: "./dist/test/helpers.d.ts" },
          "./glob/*": { types: "./dist/glob/*.d.ts" },
          "./package.json": "./package.json",
        },
      }),
      "packages/core/src/index.ts": `
declare function useStream(topic: string): unknown;
export function useCore() {
  return useStream("vessel.core");
}`,
      "packages/core/src/test/helpers.ts": "export const helper = 1;",
      "packages/core/dist/index.d.ts":
        "export declare function useCore(): unknown;",
    });
  }
  const modules = join(root, "packages/components/node_modules/@ksp-gonogo");
  mkdirSync(modules, { recursive: true });
  for (const name of ["kit", "ui", ...(marker ? ["core"] : [])]) {
    symlinkSync(join(root, "packages", name), join(modules, name), "dir");
  }
  const uiModules = join(root, "packages/ui/node_modules/@ksp-gonogo");
  mkdirSync(uiModules, { recursive: true });
  symlinkSync(join(root, "packages/kit"), join(uiModules, "kit"), "dir");
  return { root, client: join(root, "packages/components") };
}

describe("workspaceSourcePaths", () => {
  it("sends each private package's built entry points to their source", () => {
    const { root, client } = makeWorkspace();
    expect(workspaceSourcePaths(client)).toEqual({
      "@ksp-gonogo/core": [join(root, "packages/core/src/index.ts")],
      "@ksp-gonogo/core/test": [
        join(root, "packages/core/src/test/helpers.ts"),
      ],
      "@ksp-gonogo/ui": [join(root, "packages/ui/src/index.ts")],
    });
  });

  it("leaves out a published package, the client itself, wildcard and non-source exports", () => {
    const { client } = makeWorkspace();
    const names = Object.keys(workspaceSourcePaths(client));
    expect(names).not.toContain("@ksp-gonogo/kit");
    expect(names).not.toContain("@ksp-gonogo/components");
    expect(names.some((name) => name.includes("*"))).toBe(false);
    expect(names).not.toContain("@ksp-gonogo/core/package.json");
  });

  it("is empty in a workspace that is not gonogo", () => {
    const { client } = makeWorkspace({ marker: false });
    expect(workspaceSourcePaths(client)).toEqual({});
  });

  it("is empty outside any workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "no-workspace-"));
    roots.push(root);
    expect(workspaceSourcePaths(root)).toEqual({});
  });
});

describe("the private-source walk", () => {
  const scan = (client: string, workspace: boolean) => {
    put(client, {
      "src/w.tsx": `
import { useCore } from "@ksp-gonogo/core";
import { useKit } from "@ksp-gonogo/ui";
declare function registerComponent(def: object): void;
function Widget() {
  useCore();
  useKit();
  return null;
}
registerComponent({ id: "w", component: Widget });
`,
    });
    return scanClient(ts, createClientProgram(ts, client, { workspace }), {
      clientDir: client,
      indexes: createIndexReader(),
    });
  };

  it("reads a private hook from its source inside the workspace", () => {
    const { client } = makeWorkspace();
    const result = scan(client, true);
    expect(result.widgets[0].reads.map((read) => read.id).sort()).toEqual([
      "kit.topic",
      "vessel.core",
    ]);
    expect(result.indexMissing).toEqual([]);
  });

  it("still reports index-missing for a private hook without the walk", () => {
    const { client } = makeWorkspace();
    const result = scan(client, false);
    expect(result.indexMissing.map((miss) => miss.name)).toEqual(["useCore"]);
    expect(result.indexMissing[0].reason).toContain("does not export");
  });

  it("looks a re-exported hook up in the package that declares it", () => {
    const { client } = makeWorkspace();
    const result = scan(client, true);
    const kit = result.widgets[0].reads.find((read) => read.id === "kit.topic");
    expect(kit?.call).toBe("useKit");
  });
});
