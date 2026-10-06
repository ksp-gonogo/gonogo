export type PendingLevel = "break" | "addition" | "none";

export interface PackageRc {
  base: string;
  version: string;
  refused: string | null;
}

export interface PlannedPackage extends PackageRc {
  dir: string;
  tree: string;
  release: string;
  level: PendingLevel;
}

export interface RcPlan {
  run: number;
  packages: Record<string, { dir: string; version: string }>;
}

export interface Manifest {
  name: string;
  version: string;
  [field: string]: unknown;
}

export function publishedPackages(
  root?: string,
): { name: string; dir: string; version: string }[];
export function bump(version: string, level: PendingLevel): string;
export function pendingLevel(
  ledgerTexts: string[],
  packageName: string,
): PendingLevel;
export function planPackage(input: {
  release: string;
  level: PendingLevel;
  published: string[];
  run: number;
}): PackageRc;
export function plan(input: {
  root?: string;
  run: number;
  publishedVersions: (name: string) => string[];
}): { run: number; packages: Record<string, PlannedPackage> };
export function importedScopePackages(source: string): Set<string>;
export function stampManifest(
  manifest: Manifest,
  rcPlan: RcPlan,
  workspaceManifest: { devDependencies?: Record<string, string> },
  imported: Set<string>,
): {
  manifest: Manifest & {
    peerDependencies?: Record<string, string>;
  };
  pinned: string[];
  added: string[];
};
export function auditManifest(manifest: Manifest, rcPlan: RcPlan): string[];
export function stampTarball(
  tarball: string,
  rcPlan: RcPlan,
  outDir: string,
  root?: string,
): string;
export function nugetRc(tree: string, published: string[], run: number): string;
export function main(
  argv: string[],
  options?: {
    root?: string;
    npm?: (name: string) => string[];
    nuget?: (id: string) => Promise<string[]>;
    print?: (line: string) => void;
  },
): Promise<unknown>;
