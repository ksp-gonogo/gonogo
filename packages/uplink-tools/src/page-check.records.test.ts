// @vitest-environment node
//
// Node realm: this plants a client package on disk and writes files into it.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerComponent } from "@ksp-gonogo/sitrep-sdk";
import { defineUplinkClient } from "@ksp-gonogo/sitrep-sdk/spine";
import { afterEach, describe, expect, it } from "vitest";
import { checkUplinkPage, writeUplinkPage } from "./page-check";
import { WIDGET_RECORDS_FILE } from "./render/widgetRecord";

/**
 * The README and `docs/widgets.json` are one source written twice, so either
 * one edited, or one regenerated without the other, must be reported. The
 * planted cases are the proof: a check that passes them cannot see the drift
 * it exists for.
 */

const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

// One client per FILE: the registry is global and `readInventory` refuses to guess between two declared clients.
const PLANTED = defineUplinkClient({
  id: "planted-records",
  version: "1.0.0",
  name: "Planted records",
  description: "A client with one widget, to be written about.",
});

registerComponent({
  id: "planted-gauge",
  name: "Planted Gauge",
  description: "A gauge that exists to be recorded.",
  tags: ["telemetry"],
  component: () => null,
  channels: ["vessel.flight"],
  defaultSize: { w: 4, h: 3 },
  minSize: { w: 3, h: 2 },
  actions: [{ id: "toggle", label: "Toggle units", accepts: ["button"] }],
  owner: PLANTED,
});

/** A client package holding the widget's one fixture. */
function plantClient(): string {
  const dir = mkdtempSync(join(tmpdir(), "gonogo-page-records-"));
  scratch.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: "planted-records-client", version: "1.0.0" }, null, 2)}\n`,
  );
  mkdirSync(join(dir, "src", "Gauge", "__fixtures__"), { recursive: true });
  writeFileSync(join(dir, "src", "index.ts"), "export {};\n");
  writeFileSync(
    join(dir, "src", "Gauge", "__fixtures__", "steady.json"),
    `${JSON.stringify({ _scene: { widget: "planted-gauge", hero: true } })}\n`,
  );
  return dir;
}

function readRecords(dir: string): {
  widgets: Record<string, unknown>[];
} {
  return JSON.parse(readFileSync(join(dir, WIDGET_RECORDS_FILE), "utf8"));
}

describe("docs/widgets.json beside the README", () => {
  it("is written with the page, and holds what the README says", () => {
    const dir = plantClient();
    writeUplinkPage({ root: dir });

    const [record] = readRecords(dir).widgets;
    expect(record).toMatchObject({
      id: "planted-gauge",
      name: "Planted Gauge",
      defaultSize: { w: 4, h: 3 },
      minSize: { w: 3, h: 2 },
      tiny: false,
      actions: [{ id: "toggle", label: "Toggle units" }],
    });
    const readme = readFileSync(join(dir, "README.md"), "utf8");
    expect(readme).toContain("### Planted Gauge");
    expect(readme).toContain("Toggle units (`toggle`)");
    expect(readme).toContain("| Default size | 4 × 3 |");
    expect(checkUplinkPage({ root: dir }).differences).toEqual([]);
  });

  it("is reported when the record disagrees with the README", () => {
    const dir = plantClient();
    writeUplinkPage({ root: dir });
    const records = readRecords(dir);
    records.widgets[0].name = "A name the README does not say";
    writeFileSync(
      join(dir, WIDGET_RECORDS_FILE),
      `${JSON.stringify(records, null, 2)}\n`,
    );

    const { differences } = checkUplinkPage({ root: dir });
    expect(
      differences.some((d) => d.startsWith(WIDGET_RECORDS_FILE)),
      `BLIND: a hand-edited ${WIDGET_RECORDS_FILE} passed the page check`,
    ).toBe(true);
  });

  it("is reported when the README moves and the record does not", () => {
    const dir = plantClient();
    writeUplinkPage({ root: dir });
    const readmePath = join(dir, "README.md");
    writeFileSync(
      readmePath,
      readFileSync(readmePath, "utf8").replace(
        "### Planted Gauge",
        "### A heading the record does not hold",
      ),
    );

    const { differences } = checkUplinkPage({ root: dir });
    expect(differences.some((d) => d.startsWith("README.md"))).toBe(true);
    expect(differences.some((d) => d.startsWith(WIDGET_RECORDS_FILE))).toBe(
      false,
    );
  });

  it("is reported missing when a page was written without it", () => {
    const dir = plantClient();
    writeUplinkPage({ root: dir });
    rmSync(join(dir, WIDGET_RECORDS_FILE));

    expect(checkUplinkPage({ root: dir }).differences).toEqual([
      `${WIDGET_RECORDS_FILE} does not exist`,
    ]);
    expect(writeUplinkPage({ root: dir }).written).toEqual([
      WIDGET_RECORDS_FILE,
    ]);
    expect(existsSync(join(dir, WIDGET_RECORDS_FILE))).toBe(true);
  });
});
