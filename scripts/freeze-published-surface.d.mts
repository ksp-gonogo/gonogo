export interface FreezePlan {
  pending: boolean;
  breaks: string[];
  additions: string[];
  emptyNotes: string[];
  latest: string;
  carriedVersion: string;
  carriedAllowed: boolean;
  byRelease: boolean;
  next: string | null;
}
export function nextVersion(
  previous: string,
  hasBreaks: boolean,
  versioning: "semver" | "zero-major",
): string;
export function planFreeze(
  ledgerText: string,
  carriedVersion: string,
  release?: string,
): FreezePlan;
export function movesMajor(from: string, to: string): boolean;
export function replaceExtensionApiVersion(
  source: string,
  version: string,
): string;
export function replaceManifestVersion(
  manifestText: string,
  version: string,
): string;
export function releaseManifests(root?: string): string[];
export function main(argv: string[], root?: string): string[];
