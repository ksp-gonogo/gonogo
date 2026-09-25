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
 * Every top-level key any sdk source merges into one registry interface, read
 * from the source because the merge exists only at the type level. The sdk
 * spreads its declarations over several files (`plots` is in `api/plots.ts`),
 * so every file is read, and only depth-one members count: a slot's own
 * `entry:` and `topics:` are not slot ids.
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
 * Every slot a built-in widget owns must be declared in the sdk's mirror.
 *
 * An Uplink fills a first-party slot from outside this package, so it never
 * compiles `@ksp-gonogo/components` and never sees the `declare module` blocks
 * written beside each widget. The sdk's own merges (`api/slots.ts`,
 * `api/contribution-slots.ts` and their neighbours) are what reach it, and an
 * id they omit types as `never` there: the filler does not compile, while every
 * package in this repo, which does see the widget's own block, stays green.
 *
 * The owned ids come from the real registry, not from a scan of call sites,
 * because several widgets name their slots through constants.
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
