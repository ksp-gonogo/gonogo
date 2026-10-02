import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LIVE_REGION_MOUNT_DEBT } from "./live-region-mount.debt";
import { liveRegionsMountedWithContent } from "./live-region-mount.scan";
import type { SourceFile } from "./stale-references.scan";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const SOURCES: SourceFile[] = execFileSync("git", ["ls-files"], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 1 << 27,
})
  .split("\n")
  .filter(
    (f) =>
      /^(packages\/[^/]+\/src|mod\/[^/]+\/client\/src)\/.*\.tsx$/.test(f) &&
      !/\.(test|stories)\.tsx$/.test(f) &&
      !/\/(storybook|test-utils)\//.test(f),
  )
  .map((path) => ({ path, text: readFileSync(join(ROOT, path), "utf8") }));

const FOUND = new Map<string, number>();
for (const hit of liveRegionsMountedWithContent(SOURCES))
  FOUND.set(hit.file, (FOUND.get(hit.file) ?? 0) + 1);

describe("a live region stays mounted while what it reports on is on screen", () => {
  it("reads the tree, so a clean answer means it looked", () => {
    expect(SOURCES.length).toBeGreaterThan(500);
    expect(SOURCES.map((s) => s.path)).toContain(
      "packages/ui-kit/src/LiveRegion.tsx",
    );
  });

  it("renders no new live region only while it has a message", () => {
    const fresh = [...FOUND]
      .filter(([file, n]) => n > (LIVE_REGION_MOUNT_DEBT[file] ?? 0))
      .map(([file, n]) => `${file} (${n})`)
      .sort();
    expect(
      fresh,
      `These files render a live region (role="status", aria-live or <LiveRegion>) only while it has a message, so it mounts together with its first one and that announcement is often lost. Keep a <LiveRegion> mounted and change what is inside it; prove it with expectLiveRegionPrimed from @ksp-gonogo/ui-kit/testing. Do NOT add to live-region-mount.debt.ts:\n  ${fresh.join("\n  ")}`,
    ).toEqual([]);
  });

  it("records no debt that is already paid", () => {
    const paid = Object.entries(LIVE_REGION_MOUNT_DEBT)
      .filter(([file, n]) => (FOUND.get(file) ?? 0) < n)
      .map(
        ([file, n]) => `${file} (listed ${n}, found ${FOUND.get(file) ?? 0})`,
      )
      .sort();
    expect(
      paid,
      `Lower or delete these entries in live-region-mount.debt.ts:\n  ${paid.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("the live-region scan sees what it is meant to", () => {
  const PLANTED: SourceFile = {
    path: "packages/ui-kit/src/planted.tsx",
    text: [
      "export function A({ m }: { m: string }) {",
      '  return <div>{m && <span role="status">{m}</span>}</div>;',
      "}",
      "export function B({ m }: { m: string }) {",
      '  return m ? <p aria-live="polite">{m}</p> : null;',
      "}",
      "export function C({ m }: { m: string }) {",
      "  return <div>{m && <LiveRegion>{m}</LiveRegion>}</div>;",
      "}",
      "export function D({ m }: { m: string }) {",
      '  return <div>{m && <span role="alert">{m}</span>}</div>;',
      "}",
      "export function E({ m }: { m: string }) {",
      '  return <div role="status">{m}</div>;',
      "}",
      "export function F({ m }: { m: string }) {",
      "  return <div>{m ? <b>x</b> : null}<LiveRegion>{m}</LiveRegion></div>;",
      "}",
    ].join("\n"),
  };

  const found = liveRegionsMountedWithContent([PLANTED]);

  it("finds a region behind && and in a ternary branch, plain or LiveRegion", () => {
    expect(found.map((h) => h.line)).toEqual([2, 5, 8]);
  });

  it("passes an alert, a region mounted outright, and a condition that is not around it", () => {
    expect(found.map((h) => h.line)).not.toContain(11);
    expect(found.map((h) => h.line)).not.toContain(14);
    expect(found.map((h) => h.line)).not.toContain(17);
  });
});
