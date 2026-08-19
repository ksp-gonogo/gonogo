/**
 * The source roots the design-system ratchets scan, in one place.
 *
 * Both `styleguide.test.ts` (raw hex) and `styleguide-tokens.test.ts`
 * (spacing / radius / font-size / line-height / z-index) read this list.
 * They used to carry their own copies, and the hex copy quietly fell
 * behind the repo: it named six `packages/*\/src` directories and missed
 * `packages/ui-kit/src`, `packages/sitrep-client/src` and every
 * `mod/*\/client/src`, so three raw hex literals in shipped uplink
 * widgets were never gated. One list means a root can only be missing on
 * purpose, and `UNSCANNED_PACKAGE_ROOTS` makes "on purpose" explicit.
 *
 * `mod/*\/client/src` is resolved by directory listing rather than
 * enumerated, so a new uplink package is covered the day it lands. The
 * `packages/*` side stays an explicit list because some of those roots
 * must never be scanned (see below) and silently opting a new package IN
 * is the safer default only for the mod tree, where every client package
 * is a dashboard widget bundle by construction.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** UI source roots covered by every design-system ratchet. */
export const SCANNED_PACKAGE_ROOTS = [
  "packages/app/src",
  "packages/components/src",
  "packages/core/src",
  "packages/data/src",
  "packages/serial/src",
  "packages/sitrep-client/src",
  "packages/theme/src",
  "packages/ui/src",
  "packages/ui-kit/src",
];

/**
 * `packages/*\/src` roots deliberately outside the ratchets, each with the
 * reason. A root may only be absent from SCANNED_PACKAGE_ROOTS if it is
 * named here; `styleguide.test.ts` asserts the two lists together cover
 * every `packages/*\/src` on disk, so a new package cannot be born
 * unguarded by accident.
 */
export const UNSCANNED_PACKAGE_ROOTS: { path: string; reason: string }[] = [
  {
    path: "packages/sitrep-testing/src",
    reason:
      "No UI: a test harness. Re-exports the spine and the registry helpers, and its one component is a TelemetryProvider wrapper that renders no DOM of its own. No styled-components, no CSS, no colour.",
  },
  {
    path: "packages/logger/src",
    reason:
      "No UI: ring buffer, Axiom transport and error types only. No styled-components, no CSS, no colour.",
  },
  {
    path: "packages/relay/src",
    reason:
      "Fastify server plus coturn supervision. Runs in Node, renders nothing.",
  },
  {
    path: "packages/test-utils/src",
    reason:
      "Test harness only (a themed render/renderHook wrapper). Ships in no bundle and declares no styles of its own.",
  },
];

/** Every `mod/<uplink>/client/src` that exists, sorted for stable output. */
export function modClientRoots(repoRoot: string): string[] {
  const modDir = join(repoRoot, "mod");
  if (!existsSync(modDir)) return [];
  return readdirSync(modDir)
    .map((name) => join("mod", name, "client", "src"))
    .filter((rel) => {
      const abs = join(repoRoot, rel);
      return existsSync(abs) && statSync(abs).isDirectory();
    })
    .sort();
}

/** The full scan list: the packages above plus every mod client bundle. */
export function styleguideScanRoots(repoRoot: string): string[] {
  return [...SCANNED_PACKAGE_ROOTS, ...modClientRoots(repoRoot)];
}
