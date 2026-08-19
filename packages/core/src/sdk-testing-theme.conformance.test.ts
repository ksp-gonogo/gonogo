// @vitest-environment node
import { harnessTheme } from "@ksp-gonogo/sitrep-sdk/testing";
import { defaultDarkTheme } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";

/**
 * `@ksp-gonogo/sitrep-sdk/testing`'s `harnessTheme` is a PORT of
 * `@ksp-gonogo/theme`'s `defaultDarkTheme`, not a re-export: the sdk is the leaf
 * everything else depends on, so it can name neither `@ksp-gonogo/theme` (private)
 * nor `@ksp-gonogo/ui-kit` (which imports the sdk, so the edge would be a cycle).
 * This is the guard that keeps the copy honest.
 *
 * It lives in `packages/core` because core is the only package that can see both
 * ends: it already depends on the sdk AND on ui-kit, which re-exports the real
 * theme wholesale. Neither of the two packages under comparison can import the
 * other.
 *
 * It WALKS the real theme rather than listing what to check, so a token added to
 * `defaultDarkTheme` is caught by the next run without anyone remembering this file
 * exists. That property is the whole point: a fixture listing 45 keys would go
 * stale silently the first time a 46th was added.
 *
 * The first design for this was a Proxy deriving the CSS variable from the
 * property path (kebab-case the path, singularise the group). It cannot work, and
 * this test is what proved it: 18 of the 45 leaves do not follow the path.
 * `space.md` is `--space-8`, because the t-shirt names are the published
 * `ThemeSpace` contract and are deliberately not renamed to match the rung
 * numbers. `typography.size.xs` is `--font-size-xs`. `typography.weight.regular` is
 * the number `400`. `borders.subtle` is `"1px solid var(--color-border-subtle)"`.
 * No derivation recovers an arbitrary mapping, so the values are copied.
 */

type Leaf = readonly [path: string, value: unknown];

function leaves(node: unknown, path: string[] = []): Leaf[] {
  if (node === null || typeof node !== "object") {
    return [[path.join("."), node]];
  }
  return Object.entries(node).flatMap(([k, v]) => leaves(v, [...path, k]));
}

function at(node: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc === null || typeof acc !== "object"
          ? undefined
          : (acc as Record<string, unknown>)[key],
      node,
    );
}

describe("sdk/testing harnessTheme conforms to the real theme", () => {
  /**
   * The instrument check, before the comparison that could pass by finding
   * nothing. A walk that visits zero leaves reports perfect conformance, and a
   * renamed export or a theme that resolved to `{}` looks exactly like success.
   * That failure mode is why this branch exists.
   */
  it("actually walked the real theme", () => {
    const found = leaves(defaultDarkTheme);
    expect(found.length).toBeGreaterThan(40);
    // Groups, not just leaf count: a theme collapsed to one branch would still
    // clear a count threshold.
    expect(Object.keys(defaultDarkTheme).length).toBeGreaterThanOrEqual(5);
  });

  it("carries every leaf of defaultDarkTheme, byte for byte", () => {
    const drifted = leaves(defaultDarkTheme)
      .filter(([path, real]) => at(harnessTheme, path) !== real)
      .map(
        ([path, real]) =>
          `${path}: real ${JSON.stringify(real)} vs harness ${JSON.stringify(at(harnessTheme, path))}`,
      );
    expect(
      drifted,
      [
        "The sdk's harness theme has drifted from the real theme.",
        "",
        "Copy the new value across into mod/sitrep-sdk/src/testing/theme.ts. It is a",
        "deliberate port, not a re-export: the sdk leaf cannot import",
        "@ksp-gonogo/theme (private) or @ksp-gonogo/ui-kit (would cycle).",
        "",
        "Do NOT try to derive the value from the property path. 18 of these leaves",
        "do not follow it, and that design was rejected for exactly that reason.",
      ].join("\n"),
    ).toEqual([]);
  });

  /**
   * The other direction. A leaf the harness has and the theme does not is a token
   * that was renamed or deleted upstream, which the comparison above cannot see
   * because it only walks the real one.
   */
  it("carries nothing the real theme does not", () => {
    const extra = leaves(harnessTheme)
      .map(([path]) => path)
      .filter((path) => at(defaultDarkTheme, path) === undefined);
    expect(
      extra,
      "The sdk's harness theme has leaves the real theme no longer has: a token was renamed or removed upstream.",
    ).toEqual([]);
  });
});
