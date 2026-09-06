import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * An Uplink reaches the augment registry through `@ksp-gonogo/sitrep-sdk`, for
 * READING as well as writing. Never through `@ksp-gonogo/ui-kit`.
 *
 * Both packages are published, so both imports resolve and neither looks wrong.
 * They are not equivalent, for two reasons that survive and one that no longer
 * does.
 *
 * TYPES. An Uplink writes `declare module "@ksp-gonogo/sitrep-sdk"` to add its
 * slot ids, so `AugmentSlot` taken off ui-kit is typed against ui-kit's
 * `SlotRegistry`, which that declaration never merged into.
 *
 * FAILURE MODE. With no host installed the sdk's shims throw a named error that
 * says the package is not external and names the fix (`getHost()` in
 * `mod/sitrep-sdk/src/api/host.ts`); ui-kit's carry on silently. A mis-bundled
 * Uplink should fail loud at first registration.
 *
 * WHAT NO LONGER APPLIES: the second-copy trap. ui-kit's registry state was a
 * module-static `Map` until 2026-09-01, so an Uplink that inlined ui-kit instead
 * of marking it external registered into its own copy and its augments silently
 * never appeared. `packages/ui-kit/src/augments.ts` now keeps that state in one
 * `globalThis` slot and `augments.second-copy.test.ts` arranges a genuine second
 * module instance to prove two copies converge. This guard is not what stops
 * that any more; the two reasons above are why it stays.
 *
 * This is a GUARD rather than a narrowing of ui-kit's barrel, and that was
 * checked rather than assumed. `packages/core/src/augments.ts` re-exports the
 * whole augment surface from ui-kit, both to build the host and so that a
 * `declare module "@ksp-gonogo/core"` augmentation of `SlotRegistry` still merges
 * through the re-export. That app-side path is load-bearing, so the names have to
 * stay on ui-kit's barrel and the rule has to be enforced by who imports them
 * instead.
 *
 * The read half only became enforceable when `getAugmentsForSlot` and
 * `clearAugments` gained host members: before that, two Uplink tests had no way to
 * observe what their own `registerAugment` call did except ui-kit's copy, and it
 * worked purely because the shim resolved through the host into core, whose augment
 * registry IS ui-kit's. That convergence was real, undocumented, and would have
 * broken silently the first time anything got its own copy.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const MOD = join(REPO, "mod");

/** The augment registry surface. An Uplink takes all of it off the sdk. */
const UI_KIT_AUGMENT_EXPORTS = [
  "AugmentSlot",
  "registerAugment",
  "getAugmentsForSlot",
  "getAugments",
  "getAugmentSettings",
  "clearAugments",
  "onAugmentsChange",
];

const UI_KIT_IMPORT_RE =
  /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']@ksp-gonogo\/ui-kit["']/gs;

/** Every source file inside an Uplink's `client/` directory. */
function uplinkClientSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (["node_modules", "dist", ".turbo"].includes(entry)) continue;
        walk(full);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
  };
  for (const entry of readdirSync(MOD)) {
    const client = join(MOD, entry, "client");
    if (!entry.endsWith("Uplink")) continue;
    try {
      if (statSync(client).isDirectory()) walk(client);
    } catch {
      // No client half; a mod-only Uplink is fine.
    }
  }
  return out;
}

/**
 * The ONE legitimate holder of both ends: a file that installs the test host.
 *
 * `installRealTestHost` builds a whole `GonogoHost`, and the four augment members
 * are the ones `@ksp-gonogo/sitrep-sdk` cannot implement, because the registry and
 * `<AugmentSlot>` are ui-kit's and ui-kit imports the sdk. So the caller supplies
 * them, and a setup file naming them is not bypassing the host, it is CONSTRUCTING
 * it: the very indirection this rule protects is what the import feeds.
 *
 * Conditioned on the call rather than on a path allowlist, which is what makes it
 * self-limiting: a widget cannot qualify, because a widget does not install a host.
 */
function suppliesTheTestHost(text: string): boolean {
  return text.includes("installRealTestHost(");
}

/** `[file, name]` for every augment-registry name an Uplink takes off ui-kit. */
function offenders(): string[] {
  const found: string[] = [];
  for (const file of uplinkClientSources()) {
    const text = readFileSync(file, "utf8");
    if (suppliesTheTestHost(text)) continue;
    for (const match of text.matchAll(UI_KIT_IMPORT_RE)) {
      for (const raw of match[1].split(",")) {
        const name = raw
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0]
          .trim();
        if (UI_KIT_AUGMENT_EXPORTS.includes(name)) {
          found.push(`${relative(REPO, file)}  imports ${name}`);
        }
      }
    }
  }
  return found.sort();
}

describe("an Uplink reaches the augment registry through the sdk", () => {
  it("no Uplink client imports the augment registry from @ksp-gonogo/ui-kit", () => {
    expect(
      offenders(),
      `These take an augment-registry name off @ksp-gonogo/ui-kit:\n\n` +
        offenders()
          .map((o) => `  ${o}`)
          .join("\n") +
        `\n\nImport from @ksp-gonogo/sitrep-sdk instead (or, for the test-only\n` +
        `clearAugments, from @ksp-gonogo/sitrep-sdk/testing). Those are shims onto\n` +
        `the injected host, so your slot ids merge into the registry your\n` +
        `declare-module targets, and a mis-bundled Uplink throws a named error at\n` +
        `first registration instead of carrying on silently. See docs/uplink-isolation.md.`,
    ).toEqual([]);
  });

  it("exempts the test-host setup files, and there really are some", () => {
    // The instrument check for the exemption above: if `installRealTestHost` were
    // renamed, `suppliesTheTestHost` would match nothing, every setup file would
    // become an offender, and the failure would read as a widget bug. Asserting the
    // exemption FIRES means a green run above is a green run about widgets.
    const exempt = uplinkClientSources().filter((f) =>
      suppliesTheTestHost(readFileSync(f, "utf8")),
    );
    expect(exempt.length, "no file installs the test host").toBeGreaterThan(0);
  });

  it("scans a non-trivial number of Uplink client files, so a green result means something", () => {
    // Without this, a broken walk (a renamed `client/` directory, a bad prune)
    // reports zero offenders and reads exactly like compliance.
    expect(uplinkClientSources().length).toBeGreaterThan(100);
  });
});
