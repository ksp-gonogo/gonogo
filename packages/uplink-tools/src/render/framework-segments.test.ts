import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FRAMEWORK_SLOT_SEGMENTS } from "./probe-global";

describe("FRAMEWORK_SLOT_SEGMENTS", () => {
  it("lists the segments the kit aggregates for every widget", () => {
    const source = readFileSync(
      resolve(process.cwd(), "../ui-kit/src/contributionsRead.tsx"),
      "utf8",
    );
    const body = /COMPONENT_SLOT_SEGMENTS = \[([^\]]*)\]/.exec(source)?.[1];
    const kit = [...(body ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(kit.length).toBeGreaterThan(0);
    expect([...FRAMEWORK_SLOT_SEGMENTS]).toEqual(kit);
  });
});
