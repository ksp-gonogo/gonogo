// @vitest-environment node
//
// Node realm: this plants a client package on disk and writes files into it.
import {
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
import type { UplinkPackage } from "./render/context";
import {
  buildUplinkSpec,
  SPEC_FILE,
  SPEC_VERSION,
  type UplinkSpec,
  uplinkSpecJson,
} from "./render/spec";
import type { UplinkInventory } from "./render-probe";

const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

// One client per FILE: the registry is global and `readInventory` refuses to guess between two declared clients.
const PLANTED = defineUplinkClient({
  id: "planted-spec",
  version: "2.0.0",
  name: "Planted spec",
  description: "A client\n    that spans lines.",
});

registerComponent({
  id: "planted-dial",
  name: "Planted Dial",
  description: "A dial that exists to be specified.",
  tags: ["telemetry"],
  component: () => null,
  channels: ["vessel.flight"],
  defaultSize: { w: 4, h: 3 },
  owner: PLANTED,
});

function plantClient(): string {
  const dir = mkdtempSync(join(tmpdir(), "gonogo-page-spec-"));
  scratch.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: "planted-spec-client", version: "2.0.0" }, null, 2)}\n`,
  );
  mkdirSync(join(dir, "src", "Dial", "__fixtures__"), { recursive: true });
  writeFileSync(join(dir, "src", "index.ts"), "export {};\n");
  writeFileSync(
    join(dir, "src", "Dial", "__fixtures__", "steady.json"),
    `${JSON.stringify({ _scene: { widget: "planted-dial", hero: true } })}\n`,
  );
  return dir;
}

function readSpec(dir: string): UplinkSpec {
  return JSON.parse(readFileSync(join(dir, SPEC_FILE), "utf8"));
}

describe("docs/spec.json beside the README", () => {
  it("holds the Uplink, its contract stamp and its widgets as data", () => {
    const dir = plantClient();
    writeUplinkPage({ root: dir });

    const spec = readSpec(dir);
    expect(spec.specVersion).toBe(SPEC_VERSION);
    expect(spec.uplink).toMatchObject({
      id: "planted-spec",
      name: "Planted spec",
      version: "2.0.0",
      description: "A client that spans lines.",
      wraps: null,
    });
    expect(spec).not.toHaveProperty("compat");
    expect(spec.widgets.map((w) => w.id)).toEqual(["planted-dial"]);
    expect(spec.widgets[0].channels).toEqual(["vessel.flight"]);
    expect(spec.topics).toEqual([]);
    expect(checkUplinkPage({ root: dir }).differences).toEqual([]);
  });

  it("is byte-identical on a second write", () => {
    const dir = plantClient();
    writeUplinkPage({ root: dir });
    const first = readFileSync(join(dir, SPEC_FILE), "utf8");
    expect(writeUplinkPage({ root: dir }).written).toEqual([]);
    expect(readFileSync(join(dir, SPEC_FILE), "utf8")).toBe(first);
  });

  it("is reported when it is edited by hand", () => {
    const dir = plantClient();
    writeUplinkPage({ root: dir });
    const spec = readSpec(dir);
    spec.uplink.version = "9.9.9";
    writeFileSync(join(dir, SPEC_FILE), `${JSON.stringify(spec, null, 2)}\n`);

    const { differences } = checkUplinkPage({ root: dir });
    expect(
      differences.some((d) => d.startsWith(SPEC_FILE)),
      `BLIND: a hand-edited ${SPEC_FILE} passed the page check`,
    ).toBe(true);
  });

  it("is reported missing when a page was written without it", () => {
    const dir = plantClient();
    writeUplinkPage({ root: dir });
    rmSync(join(dir, SPEC_FILE));

    expect(checkUplinkPage({ root: dir }).differences).toEqual([
      `${SPEC_FILE} does not exist`,
    ]);
    expect(writeUplinkPage({ root: dir }).written).toEqual([SPEC_FILE]);
  });
});

describe("the spec sheet and the contract stamp", () => {
  const inventoryAt = (contractMinor: number): UplinkInventory => ({
    id: "stamped",
    name: "Stamped",
    version: "1.0.0",
    description: "An Uplink.",
    compat: { apiVersion: "1.0", contractMajor: 39, contractMinor },
    widgets: [],
    augments: [],
    contributions: [],
    processors: [],
    processorTopicDeps: {},
    reckonedTopics: [],
    reckonerExemptions: [],
    derivedChannels: [],
    declaredClients: [],
    hosts: [],
  });
  const wire = {
    present: false,
    channels: [],
    nested: [],
    payloads: [],
    commands: [],
    argShapes: [],
  };

  it("is byte-identical when only the contract Minor moves", () => {
    const dir = mkdtempSync(join(tmpdir(), "gonogo-spec-stamp-"));
    scratch.push(dir);
    const pkg = { dir } as UplinkPackage;
    const at = (minor: number) =>
      uplinkSpecJson(buildUplinkSpec(pkg, inventoryAt(minor), wire, []));
    expect(at(1)).toBe(at(2));
  });
});
