import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getComponents } from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
import "../index";

const SDK_SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "mod",
  "sitrep-sdk",
  "src",
);

function sdkSources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === "__tests__" || entry === "__generated__"
        ? []
        : sdkSources(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test(-d)?\.tsx?$/.test(entry)
      ? [full]
      : [];
  });
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * Every depth-one key any sdk source file merges into one registry interface,
 * read from source because the merge exists only at the type level. A slot's
 * own `entry:` is not a slot id.
 */
function mirroredKeys(iface: string): Set<string> {
  const keys = new Set<string>();
  const opener = new RegExp(`\\binterface ${iface}\\s*\\{`, "g");
  for (const file of sdkSources(SDK_SRC)) {
    const text = stripComments(readFileSync(file, "utf8"));
    for (const match of text.matchAll(opener)) {
      let depth = 1;
      const lines = text.slice(match.index + match[0].length).split("\n");
      for (const line of lines) {
        if (depth === 1) {
          const key = /^\s*(?:"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/.exec(line);
          if (key) keys.add(key[1] ?? key[2]);
        }
        depth += (line.match(/\{/g) ?? []).length;
        depth -= (line.match(/\}/g) ?? []).length;
        if (depth <= 0) break;
      }
    }
  }
  return keys;
}

/** Every id a widget declares that the mirror does not name, as `widget: slot`. */
function unmirrored(
  owned: ReadonlyArray<{ id: string; slot: string }>,
  mirror: ReadonlySet<string>,
): string[] {
  return owned
    .filter(({ slot }) => !mirror.has(slot))
    .map(({ id, slot }) => `${id}: ${slot}`)
    .sort();
}

/**
 * Every slot a built-in widget owns must be declared in the sdk's mirror: an
 * Uplink filling it never compiles `@ksp-gonogo/components`, so an id the
 * mirror omits types as `never` there while this repo stays green. Owned ids
 * come from the real registry, since several widgets name slots by constant.
 */
describe("the sdk mirrors every slot a built-in widget owns", () => {
  const components = getComponents();
  const augmentSlots = components.flatMap((def) =>
    (def.augmentSlots ?? []).map((slot) => ({ id: def.id, slot })),
  );
  const contributionSlots = components.flatMap((def) =>
    (def.contributionSlots ?? []).map((slot) => ({ id: def.id, slot })),
  );
  const slotMirror = mirroredKeys("SlotRegistry");
  const contributionMirror = mirroredKeys("ContributionRegistry");

  it("read a non-trivial registry and both mirrors", () => {
    expect(augmentSlots.length).toBeGreaterThan(20);
    expect(contributionSlots.length).toBeGreaterThan(5);
    expect(slotMirror.size).toBeGreaterThan(20);
    expect(contributionMirror.size).toBeGreaterThan(5);
  });

  it("declares every augment slot in the sdk", () => {
    expect(unmirrored(augmentSlots, slotMirror)).toEqual([]);
  });

  it("declares every contribution slot in the sdk", () => {
    expect(unmirrored(contributionSlots, contributionMirror)).toEqual([]);
  });

  it("reports a slot the mirror drops", () => {
    const [dropped] = augmentSlots;
    const thinned = new Set(slotMirror);
    thinned.delete(dropped.slot);
    expect(unmirrored(augmentSlots, thinned)).toContain(
      `${dropped.id}: ${dropped.slot}`,
    );
  });
});
