import type { StorybookConfig } from "@storybook/react-vite";
import { workspaceAliases } from "../../app/workspaceAlias.ts";

/**
 * Workspace packages resolve to their TypeScript source, exactly as the app's
 * dev server resolves them, so a story renders the code in the tree rather than
 * whatever `dist` was last built.
 */
type AliasList = { find: string | RegExp; replacement: string }[];

function workspaceAlias(): AliasList {
  return Object.entries(workspaceAliases()).map(([find, replacement]) => ({
    find,
    replacement,
  }));
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
