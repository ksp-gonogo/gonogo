// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Whether a likely refusal stops the press or is advised is decided in one
 * place, by how long the verdict has been held (`useCommand`'s
 * `gateStopsPress`, applied by the kit's command controls and `adviceFor`). A
 * widget names a reason and never draws the advised state itself, so none of
 * them can decide for itself that its control is always advised or never.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..");

/** What only the central layer may write: the advised edge, its attribute and its sentence. */
const OWN_DECISION = [
  /["']at-risk["']/,
  /data-predicted=["']/,
  /[Ll]ikely to be refused/,
];

function decidesAdviceItself(source: string): string | null {
  for (const pattern of OWN_DECISION) {
    if (pattern.test(source)) return pattern.source;
  }
  return null;
}

function widgetSources(): string[] {
  const listed = execFileSync(
    "git",
    ["ls-files", "packages/components/src", "mod/*/client/src"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);
  return listed.filter(
    (file) =>
      /\.(ts|tsx)$/.test(file) &&
      !/\.(test|test-d|stories)\.(ts|tsx)$/.test(file) &&
      !file.includes("__fixtures__") &&
      !file.includes("__generated__") &&
      !file.includes("/scripts/") &&
      !file.includes("/test/"),
  );
}

describe("styleguide: refuse-or-advise is decided centrally", () => {
  const files = widgetSources();

  it("reads the widget sources, including the ones that carry advice", () => {
    expect(files.length).toBeGreaterThan(300);
    for (const file of [
      "packages/components/src/SpaceCenterStatus/index.tsx",
      "packages/components/src/Navball/ControlSurface.tsx",
    ]) {
      expect(files).toContain(file);
    }
  });

  it("finds no widget that draws the advised state or writes its sentence itself", () => {
    const offenders = files
      .map(
        (file) =>
          [
            file,
            decidesAdviceItself(readFileSync(join(ROOT, file), "utf8")),
          ] as const,
      )
      .filter(([, hit]) => hit !== null)
      .map(([file, hit]) => `${file}: ${hit}`);
    expect(offenders).toEqual([]);
  });

  it("fails on a planted control that decides for itself, so a pattern that stopped matching is seen", () => {
    expect(
      decidesAdviceItself('<Button predictedOutcome="at-risk">Go</Button>'),
    ).not.toBeNull();
    expect(decidesAdviceItself('<Button data-predicted="x" />')).not.toBeNull();
    expect(
      decidesAdviceItself(
        "<Button data-predicted={advice.predictedOutcome} />",
      ),
    ).toBeNull();
    expect(
      decidesAdviceItself(
        ["const tip = ", "`Likely to be refused: `"].join(""),
      ),
    ).not.toBeNull();
    expect(
      decidesAdviceItself("<Button advise={reason}>Go</Button>"),
    ).toBeNull();
  });
});
