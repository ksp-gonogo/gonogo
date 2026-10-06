export type Bump = "major" | "minor" | "patch";

export interface Manifest {
  name: string;
  version: string;
  [field: string]: unknown;
}

export interface ReleasePlan {
  release: string;
  version: string;
  tag: string;
  packages: Record<string, { dir: string; firstVersion: boolean }>;
  nuget: { id: string; firstVersion: boolean };
}

export const RELEASE_VERSION_FILE: string;
export const NUGET_ID: string;
export function treeRelease(root?: string): string;
export function publishedPackages(
  root?: string,
): { name: string; dir: string; version: string }[];
export function compareVersions(a: string, b: string): number;
export function bumpFromLog(log: string): Bump;
export function nextRelease(current: string, bump: Bump): string;
export function plan(input: {
  root?: string;
  release: string;
  run?: number;
  npmVersions: (name: string) => string[];
  nugetVersions: string[];
  tags: string[];
}): ReleasePlan;
export function importedScopePackages(source: string): Set<string>;
export function stampManifest(
  manifest: Manifest,
  version: string,
  siblings: Set<string>,
  workspaceManifest: { devDependencies?: Record<string, string> },
  imported: Set<string>,
): {
  manifest: Manifest & {
    peerDependencies?: Record<string, string>;
  };
  pinned: string[];
  added: string[];
};
export function auditManifest(
  manifest: Manifest,
  version: string,
  siblings: Set<string>,
): string[];
export function stampTarball(
  tarball: string,
  version: string,
  outDir: string,
  root?: string,
): string;
export function main(
  argv: string[],
  options?: {
    root?: string;
    npm?: (name: string) => string[];
    nuget?: (id: string) => Promise<string[]>;
    tags?: () => string[];
    log?: () => string;
    print?: (line: string) => void;
  },
): Promise<unknown>;
