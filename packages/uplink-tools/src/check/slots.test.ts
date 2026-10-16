import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { scanFiles } from "./fixture";
import { loadTypeScript, type TypeScript } from "./program";
import { bundleSlotRule } from "./rules/bake";
import { slotUnknownRule } from "./rules/declarations/widget-rules";
import { PACKAGE_JSON, UPLINK_JSON, uplinkOn } from "./rules/fixture";
import { closestSlots } from "./slots";

let ts: TypeScript;
beforeAll(async () => {
  ts = await loadTypeScript(import.meta.dirname);
});

const REGISTRIES = `
export interface SlotRegistry { "ground-track.overlay": true }
export interface ContributionRegistry { "tracking-station.entities": { entry: 1 } }
`;

const client = (body: string) =>
  scanFiles(ts, {
    "reg.ts": REGISTRIES,
    "c.ts": `declare function registerContribution(def: object): void;
declare function registerAugment(def: object): void;
declare function registerComponent(def: object): void;
${body}`,
  });

const judge = (scan: ReturnType<typeof client>) =>
  slotUnknownRule.check({ clientDir: "/client", scan, dynamicPrefixes: [] });

describe("declarations/slot-unknown", () => {
  it("fails a contribution naming a slot that was renamed, and names the close slot", () => {
    const found = judge(
      client(
        `registerContribution({ id: "cme", contributes: "system-view.entities" });`,
      ),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      rule: "declarations/slot-unknown",
      severity: "error",
      line: 4,
    });
    expect(found[0].message).toContain("system-view.entities");
    expect(found[0].message).toContain("tracking-station.entities");
  });

  it("fails an augment naming an unknown slot", () => {
    const found = judge(
      client(`registerAugment({ id: "a", augments: "ground-track.overlai" });`),
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("ground-track.overlay");
  });

  it("passes declared slots, a standard segment under any widget, and a slot its own widget declares", () => {
    const found = judge(
      client(`
registerContribution({ id: "a", contributes: "tracking-station.entities" });
registerAugment({ id: "b", augments: "ground-track.overlay" });
registerContribution({ id: "c", contributes: "some-widget.badges" });
registerComponent({ id: "mine", contributionSlots: ["mine.lines"] });
registerContribution({ id: "d", contributes: "mine.lines" });`),
    );
    expect(found).toEqual([]);
  });

  it("judges nothing when the sdk's slot registries are not in the program", () => {
    const scan = scanFiles(ts, {
      "c.ts": `declare function registerContribution(def: object): void;
registerContribution({ id: "x", contributes: "nowhere.at-all" });`,
    });
    expect(scan.knownSlots).toEqual([]);
    expect(judge(scan)).toEqual([]);
  });
});

describe("bake/bundle-slot-unknown", () => {
  const made = (bundle: string) => {
    const { clientDir } = uplinkOn({
      "uplink.json": UPLINK_JSON(),
      "client/package.json": PACKAGE_JSON(),
      "client/src/index.ts": "export const x = 1;\n",
    });
    mkdirSync(clientDir, { recursive: true });
    const scan = client(
      `registerContribution({ id: "ok", contributes: "tracking-station.entities" });`,
    );
    const rule = bundleSlotRule((_dir, outFile) => {
      writeFileSync(outFile, bundle);
      return { ok: true };
    });
    return rule.check({ clientDir, scan, ts, dynamicPrefixes: [] });
  };

  it("fails a built bundle that names an unknown slot, even minified", () => {
    const found = made(
      `var a=r.registerContribution({id:"cme",contributes:"system-view.entities",compute:()=>null});`,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      rule: "bake/bundle-slot-unknown",
      severity: "error",
    });
    expect(found[0].message).toContain("system-view.entities");
  });

  it("passes a bundle that names only known slots", () => {
    expect(
      made(
        `x.registerAugment({id:"a",augments:"ground-track.overlay"});x.registerContribution({id:"b",contributes:"w.badges"});`,
      ),
    ).toEqual([]);
  });
});

describe("closestSlots", () => {
  it("prefers the same trailing segment under another widget", () => {
    expect(
      closestSlots("system-view.entities", [
        "tracking-station.entities",
        "ground-track.overlay",
      ]),
    ).toEqual(["tracking-station.entities"]);
  });
});
