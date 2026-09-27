import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import { workspaceAliases } from "../../app/workspaceAlias.ts";

/**
 * Workspace packages resolve to their TypeScript source, exactly as the app's
 * dev server resolves them, so a story renders the code in the tree rather than
 * whatever `dist` was last built.
 */
type AliasList = { find: string | RegExp; replacement: string }[];

/**
 * Subpaths a package publishes through a conditional `exports` entry, which
 * the app's alias leaves to `dist` and then swallows into the bare package's
 * source path. Each is pointed at the source file its `dist` entry is built
 * from, so `@ksp-gonogo/ui-kit/testing` and the render probe load as source
 * like everything else.
 */
function conditionalSubpaths(): AliasList {
  const packages = fileURLToPath(new URL("../..", import.meta.url));
  const out: AliasList = [];
  for (const dir of readdirSync(packages)) {
    const manifest = join(packages, dir, "package.json");
    if (!existsSync(manifest)) continue;
    const { name, exports } = JSON.parse(readFileSync(manifest, "utf8"));
    for (const [key, entry] of Object.entries(exports ?? {})) {
      if (key === "." || typeof entry !== "object" || entry === null) continue;
      const built = (entry as { import?: unknown }).import;
      if (typeof built !== "string") continue;
      const stem = built.replace(/^\.\/dist\//, "src/").replace(/\.js$/, "");
      const source = [".ts", ".tsx"]
        .map((ext) => join(packages, dir, `${stem}${ext}`))
        .find(existsSync);
      if (source)
        out.push({ find: `${name}/${key.slice(2)}`, replacement: source });
    }
  }
  return out;
}

const VITEST_STUB = {
  find: /^vitest$/,
  replacement: fileURLToPath(new URL("./vitest-stub.ts", import.meta.url)),
};

function workspaceAlias(): AliasList {
  return [
    VITEST_STUB,
    ...conditionalSubpaths(),
    ...Object.entries(workspaceAliases()).map(([find, replacement]) => ({
      find,
      replacement,
    })),
  ];
}

function existingAlias(
  alias: AliasList | Record<string, string> | undefined,
): AliasList {
  if (alias === undefined) return [];
  if (Array.isArray(alias)) return alias;
  return Object.entries(alias).map(([find, replacement]) => ({
    find,
    replacement,
  }));
}

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: [
    "../src/**/*.stories.@(ts|tsx)",
    "../dist/stories/**/*.stories.@(ts|tsx)",
  ],
  staticDirs: ["../../app/public"],
  core: { disableTelemetry: true },
  viteFinal: (vite) => ({
    ...vite,
    resolve: {
      ...vite.resolve,
      alias: [...workspaceAlias(), ...existingAlias(vite.resolve?.alias)],
      dedupe: ["react", "react-dom", "styled-components"],
    },
    define: {
      ...vite.define,
      "process.env.NODE_ENV": JSON.stringify(
        process.env.NODE_ENV ?? "development",
      ),
    },
  }),
};

export default config;
