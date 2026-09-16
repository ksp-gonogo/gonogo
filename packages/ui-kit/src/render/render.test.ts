// @vitest-environment node
//
// Node realm: every piece under test here reads the filesystem or builds a
// string, and none of it touches the DOM. The browser half is exercised by
// running the tool against a real Uplink, which is what `gonogo-uplink render`
// is; this file covers the parts that decide whether a run happens at all.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import type { UplinkInventory } from "../render-probe";
import { refuseToClobberHandWrittenReadme } from "./cli";
import { resolveUplinkPackage } from "./context";
import { README_GENERATED_MARKER, scenesAssertingNothing } from "./docs";
import { encodeGif } from "./gif";
import { generateEntry, oneCopyPerPage } from "./page";
import { decodePng } from "./png";
import { assertEveryWidgetCovered, buildScenes } from "./scenes";

const temporaries: string[] = [];

afterEach(() => {
  for (const dir of temporaries.splice(0)) rmSync(dir, { recursive: true });
});

/** A throwaway Uplink client package on disk, since every path here is real. */
function fakePackage(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "gonogo-render-test-"));
  temporaries.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "@example/uplink", version: "1.2.3" }),
  );
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "index.ts"), "export {};\n");
  for (const [path, contents] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents);
  }
  return dir;
}

const INVENTORY: UplinkInventory = {
  id: "example",
  name: "Example",
  version: "1.2.3",
  compat: {
    apiVersion: "1.0.0",
    uiKitVersion: "0.2.0",
    contractMajor: 12,
    contractMinor: 22,
  },
  declaredClients: ["core", "example"],
  widgets: [
    {
      id: "reactor",
      name: "Reactor",
      description: "A reactor.",
      tags: [],
      channels: ["example.reactor"],
      optionalChannels: [],
      dataRequirements: [],
      actions: [],
      augmentSlots: [],
      contributionSlots: [],
      requires: [],
      pushable: false,
      behaviors: [],
      modes: [
        { name: "default", w: 6, h: 6, pxW: 232, pxH: 190 },
        { name: "min", w: 3, h: 3, pxW: 112, pxH: 91 },
      ],
    },
  ],
  augments: [
    {
      id: "reactor-badge",
      augments: "console.header",
      channels: ["example.reactor"],
      suppressesVanillaBase: false,
      settings: [],
    },
  ],
  contributions: [],
  processors: [],
  processorTopicDeps: {},
  reckonedTopics: [],
  reckonerExemptions: [],
  derivedChannels: [],
  hosts: [
    {
      id: "console",
      name: "Console",
      description: "A host this Uplink does not own.",
      tags: [],
      channels: ["host.status"],
      optionalChannels: [],
      dataRequirements: [],
      actions: [],
      augmentSlots: ["console.header"],
      contributionSlots: [],
      requires: [],
      pushable: false,
      behaviors: [],
      modes: [{ name: "default", w: 9, h: 4, pxW: 352, pxH: 124 }],
    },
  ],
};

/**
 * The single-copy pins. A `--with` module lives outside the Uplink's package, so
 * its imports resolve from a different `node_modules` when the two are separate
 * installs, and every shared package is bundled twice. React is the one that
 * bites: an augment mounted inside a cross-package host threw "Cannot read
 * properties of null (reading 'useEffect')" from its first hook.
 *
 * Both assertions below are about the alias VALUE, and both are mistakes that
 * were made and measured on the way to this rule rather than hypotheticals.
 */
describe("one copy per page", () => {
  it("pins a package to its directory, so subpaths and conditions still resolve", () => {
    const alias = oneCopyPerPage(join(__dirname, ".."));
    // esbuild substitutes an alias at the START of an import path, so a value
    // pointing at the ENTRY FILE turns `react-dom/test-utils` into
    // `.../react-dom/index.js/test-utils`, which is a build error rather than a
    // wrong render. A directory is also what leaves the export CONDITION to
    // esbuild: the CJS half a Node resolver picks needed Node's `stream` for
    // styled-components and failed the build a second way.
    expect(Object.keys(alias)).toContain("react");
    for (const [specifier, value] of Object.entries(alias)) {
      expect(statSync(value).isDirectory(), `${specifier} -> ${value}`).toBe(
        true,
      );
      expect(existsSync(join(value, "package.json"))).toBe(true);
    }
  });

  it("names only what it could resolve, so an unreachable package is left to esbuild", () => {
    // The catch arm. A specifier the Uplink cannot reach has no copy here to BE
    // the one copy, and throwing would fail a render with nothing wrong with
    // it. Asserted as a subset rather than as an empty map, because a resolver
    // walks to the filesystem root and then to Node's global folders, so
    // "nothing is installed near this directory" is not a state a test can
    // arrange on every machine.
    const alias = oneCopyPerPage(
      mkdtempSync(join(tmpdir(), "gonogo-nomodules-")),
    );
    for (const specifier of Object.keys(alias)) {
      expect(["react", "react-dom", "styled-components"]).toContain(specifier);
    }
  });
});

/**
 * Every hook `RenderSetup` offers an author is a hook the probe actually calls.
 *
 * `afterScene` was declared and never called for the life of the harness, so
 * every scene's teardown had never run. The one setup that writes a real one
 * restores `globalThis.fetch`, cancels a held-input timer and disconnects its
 * source, and each scene had been leaving all three standing for whatever
 * rendered next. Nothing reported it, because a declared-and-uncalled hook is
 * not a type error, not an unused export, and not visible in any render. An
 * author reading the interface has no way to tell the difference either.
 *
 * Source text rather than behaviour, deliberately: the call site is in the
 * BROWSER half, which this node realm cannot mount, and the defect is
 * structural rather than conditional. Both halves are read off the file rather
 * than typed here, so a fifth hook added to the interface and not called fails
 * without anyone editing this test.
 *
 * It reads `renderScene`'s OWN BODY and not the whole file, which is the
 * difference between a check and a decoration. The first draft asked whether
 * the file MENTIONED each hook, and removing the call passed it: the mention
 * had moved into a helper that nothing called any more, which is the same shape
 * as the bug. `renderScene` is what the driver invokes, so a call in its body
 * is one that runs.
 */
describe("the setup hooks the probe offers", () => {
  const probeSource = readFileSync(
    join(__dirname, "..", "render-probe.tsx"),
    "utf8",
  );

  /** The optional hook names declared on `RenderSetup`, read off the block. */
  function declaredHooks(): string[] {
    const block = probeSource.match(
      /export interface RenderSetup \{([\s\S]*?)\n\}/,
    );
    if (!block) throw new Error("RenderSetup interface not found");
    return [...block[1].matchAll(/^ {2}(\w+)\?:/gm)].map((m) => m[1]);
  }

  /** `renderScene`, from its signature to its closing brace at column zero. */
  function renderSceneBody(): string {
    const body = probeSource.match(
      /\nasync function renderScene\([\s\S]*?\n\}\n/,
    );
    if (!body) throw new Error("renderScene not found");
    return body[0];
  }

  it("reads a real interface and a real function body", () => {
    /* Both extractors, because either one silently matching nothing reports a
       clean tree: an empty hook list has no uncalled member, and an empty body
       is only caught by the assertion above it. */
    expect(declaredHooks().sort()).toEqual([
      "afterMount",
      "afterScene",
      "beforeScene",
      "wrap",
    ]);
    expect(renderSceneBody().length).toBeGreaterThan(1000);
  });

  it("calls every hook it declares, from the function the driver invokes", () => {
    const body = renderSceneBody();
    const uncalled = declaredHooks().filter(
      (hook) => !body.includes(`activeSetup.${hook}`),
    );
    expect(uncalled).toEqual([]);
  });
});

describe("the generated browser entry", () => {
  it("awaits the host install before importing the client", () => {
    const dir = fakePackage({});
    const entry = generateEntry(resolveUplinkPackage(dir));
    const install = entry.indexOf("await installRenderProbe()");
    const client = entry.indexOf('await import("');
    expect(install).toBeGreaterThan(-1);
    expect(client).toBeGreaterThan(install);
    // A STATIC import of the client would be hoisted above the install and the
    // widget's module-load `registerComponent` would throw against no host, so
    // the dynamic form is the property under test rather than a style choice.
    expect(entry).not.toMatch(/^import .*src\/index/m);
  });

  it("includes the author's setup file only when there is one", () => {
    const without = generateEntry(resolveUplinkPackage(fakePackage({})));
    expect(without).not.toContain("gonogo-render.setup");

    const with_ = generateEntry(
      resolveUplinkPackage(
        fakePackage({ "gonogo-render.setup.ts": "export default {};\n" }),
      ),
    );
    expect(with_).toContain("gonogo-render.setup.ts");
  });

  it("prefers source over a built main, so a render is never of a stale build", () => {
    const dir = fakePackage({ "dist/index.js": "export {};\n" });
    expect(resolveUplinkPackage(dir).entry).toMatch(/src\/index\.ts$/);
  });

  it("bundles the hosts a package declares, before its own client", () => {
    const dir = fakePackage({
      "hosts.ts": "export {};\n",
      "package.json": JSON.stringify({
        name: "@example/uplink",
        version: "1.2.3",
        gonogo: { renderWith: ["./hosts.ts"] },
      }),
    });
    const pkg = resolveUplinkPackage(dir);
    expect(pkg.renderWith).toHaveLength(1);

    // Order is the property: a host has to be registered before the augment
    // that names it, or `AugmentSlot` mounts against nothing.
    const entry = generateEntry(pkg, pkg.renderWith);
    expect(entry.indexOf("hosts.ts")).toBeLessThan(
      entry.indexOf("src/index.ts"),
    );
  });

  it("names the declaration when a declared host module is missing", () => {
    const dir = fakePackage({
      "package.json": JSON.stringify({
        name: "@example/uplink",
        version: "1.2.3",
        gonogo: { renderWith: ["./gone.ts"] },
      }),
    });
    expect(() => resolveUplinkPackage(dir)).toThrow(/renderWith.*gone\.ts/s);
  });

  it("refuses a module SPECIFIER, which needs a dependency the rules forbid", () => {
    const dir = fakePackage({
      "package.json": JSON.stringify({
        name: "@example/uplink",
        version: "1.2.3",
        gonogo: { renderWith: ["@ksp-gonogo/components"] },
      }),
    });
    expect(() => resolveUplinkPackage(dir)).toThrow(/not a module specifier/);
  });
});

describe("fixtures become scenes", () => {
  const fixture = (body: unknown) =>
    fakePackage({
      "src/Reactor/__fixtures__/hot.json": JSON.stringify(body),
    });

  it("derives the carried channels from the registration", () => {
    const pkg = resolveUplinkPackage(
      fixture({
        _scene: { widget: "reactor" },
        _stream: { emits: [{ topic: "example.reactor", payload: {} }] },
      }),
    );
    const [scene] = buildScenes(pkg, INVENTORY);
    expect(scene.carriedChannels).toEqual(["example.reactor"]);
  });

  it("derives the modes from defaultSize and minSize", () => {
    const pkg = resolveUplinkPackage(
      fixture({ _scene: { widget: "reactor" } }),
    );
    const [scene] = buildScenes(pkg, INVENTORY);
    expect(scene.modes.map((m) => m.name)).toEqual(["default", "min"]);
  });

  it("lets a fixture narrow the mode set and not widen it", () => {
    const narrowed = buildScenes(
      resolveUplinkPackage(
        fixture({ _scene: { widget: "reactor", modes: ["min"] } }),
      ),
      INVENTORY,
    );
    expect(narrowed[0].modes.map((m) => m.name)).toEqual(["min"]);

    expect(() =>
      buildScenes(
        resolveUplinkPackage(
          fixture({ _scene: { widget: "reactor", modes: ["enormous"] } }),
        ),
        INVENTORY,
      ),
    ).toThrow(/not a mode this target has/);
  });

  it("names the registered ids when a scene points at nothing", () => {
    expect(() =>
      buildScenes(
        resolveUplinkPackage(fixture({ _scene: { widget: "reactorr" } })),
        INVENTORY,
      ),
    ).toThrow(/Registered widget ids: reactor/);
  });

  it("refuses a fixture that does not say what it is a fixture of", () => {
    expect(() =>
      buildScenes(resolveUplinkPackage(fixture({ output: 42 })), INVENTORY),
    ).toThrow(/no "_scene" block/);
  });

  it("refuses a scene naming two targets at once", () => {
    expect(() =>
      buildScenes(
        resolveUplinkPackage(
          fixture({ _scene: { widget: "reactor", augment: "reactor-badge" } }),
        ),
        INVENTORY,
      ),
    ).toThrow(/names widget and augment/);
  });

  it("routes bare top-level keys to a legacy data source", () => {
    const pkg = resolveUplinkPackage(
      fixture({ _scene: { widget: "reactor" }, "v.altitude": 1200 }),
    );
    const [scene] = buildScenes(pkg, INVENTORY);
    expect(scene.dataSources).toEqual({ data: { "v.altitude": 1200 } });
  });

  it("sizes and feeds a hosted augment scene as its HOST", () => {
    const pkg = resolveUplinkPackage(
      fixture({
        _scene: { augment: "reactor-badge", host: "console" },
        _stream: { emits: [{ topic: "example.reactor", payload: {} }] },
      }),
    );
    const [scene] = buildScenes(pkg, INVENTORY);
    // The host is what is on screen, so its tile and its topics are the scene's.
    // A stand-in size would render the real widget at a shape nobody sees.
    expect(scene.modes.map((m) => m.name)).toEqual(["default"]);
    expect(scene.modes[0]).toMatchObject({ w: 9, h: 4 });
    expect(scene.carriedChannels).toContain("host.status");
    expect(scene.carriedChannels).toContain("example.reactor");
  });

  it("lets a hosted scene name the tile the host is actually run at", () => {
    // The host's `defaultSize` is chosen for the host alone. An operator who
    // has added three sections to it has resized it, and the render of that
    // widget at its bare default is a picture of a tile nobody is using.
    const [scene] = buildScenes(
      resolveUplinkPackage(
        fixture({
          _scene: {
            augment: "reactor-badge",
            host: "console",
            size: { w: 13, h: 14 },
          },
        }),
      ),
      INVENTORY,
    );
    expect(scene.modes).toHaveLength(1);
    expect(scene.modes[0]).toMatchObject({ w: 13, h: 14 });
    expect(scene.modes[0].pxW).toBeGreaterThan(352);
  });

  it("names --with when a scene's host is not in the bundle", () => {
    expect(() =>
      buildScenes(
        resolveUplinkPackage(
          fixture({ _scene: { augment: "reactor-badge", host: "dashboard" } }),
        ),
        INVENTORY,
      ),
    ).toThrow(/--with/);
  });

  it("refuses a host on a WIDGET scene, which is its own host", () => {
    expect(() =>
      buildScenes(
        resolveUplinkPackage(
          fixture({ _scene: { widget: "reactor", host: "console" } }),
        ),
        INVENTORY,
      ),
    ).toThrow(/which IS the host/);
  });

  /**
   * A hostless contribution scene, which this file used to refuse outright
   * though `render-probe.tsx` implements one.
   *
   * The line is whether the FRAMEWORK draws the slot or a host's own body does.
   * `<id>.badges` is drawn by `Panel` for every host, so a stand-in renders it
   * exactly as the real widget would; both of the refusals below were measured
   * by running the real harness with the host removed, and each photographed a
   * blank frame.
   */
  describe("a contribution scene with no host", () => {
    const withContribution = (contributes: string): UplinkInventory => ({
      ...INVENTORY,
      contributions: [
        { id: "entry-badges", contributes, deps: [], settings: [] },
      ],
    });

    const build = (contributes: string) =>
      buildScenes(
        resolveUplinkPackage(
          fixture({ _scene: { contribution: "entry-badges" } }),
        ),
        withContribution(contributes),
      );

    it("builds on a badges slot, which the framework draws for every host", () => {
      const [scene] = build("landing-status.badges");
      expect(scene.host).toBeUndefined();
      expect(scene.target).toEqual({
        kind: "contribution",
        id: "entry-badges",
      });
    });

    it("is refused on a slot the host's own body draws", () => {
      expect(() => build("ship-map.part-meters")).toThrow(
        /"ship-map\.part-meters", which its host draws itself/,
      );
    });

    it("is refused on a global slot, which belongs to no widget at all", () => {
      expect(() => build("plots")).toThrow(/"plots", which its host draws/);
    });
  });

  it("carries _scene.paints through, and refuses one that asserts nothing", () => {
    const [scene] = buildScenes(
      resolveUplinkPackage(
        fixture({ _scene: { widget: "reactor", paints: ["CRITICAL", "80%"] } }),
      ),
      INVENTORY,
    );
    expect(scene.paints).toEqual(["CRITICAL", "80%"]);

    // An empty string matches every element, so accepting one would be a check
    // that reads as written and asserts nothing.
    expect(() =>
      buildScenes(
        resolveUplinkPackage(
          fixture({ _scene: { widget: "reactor", paints: [""] } }),
        ),
        INVENTORY,
      ),
    ).toThrow(/matches every element/);
  });

  it("carries _scene.before in order, and refuses an act naming nothing", () => {
    const [scene] = buildScenes(
      resolveUplinkPackage(
        fixture({
          _scene: {
            widget: "reactor",
            before: [
              { press: "Draft plan" },
              { hover: "video" },
              { rest: true },
            ],
          },
        }),
      ),
      INVENTORY,
    );
    expect(scene.before).toEqual([
      { press: "Draft plan" },
      { hover: "video" },
      { rest: true },
    ]);

    expect(() =>
      buildScenes(
        resolveUplinkPackage(
          fixture({ _scene: { widget: "reactor", before: [{ click: "x" }] } }),
        ),
        INVENTORY,
      ),
    ).toThrow(/exactly one of press \/ hover \/ rest/);
  });

  it("refuses paints on a motion scene, which has no one moment to check", () => {
    expect(() =>
      buildScenes(
        resolveUplinkPackage(
          fixture({
            _scene: {
              widget: "reactor",
              paints: ["CRITICAL"],
              steps: [{ advanceUt: 60, frames: 4 }],
            },
          }),
        ),
        INVENTORY,
      ),
    ).toThrow(/cannot both be set/);
  });

  it("defaults every emission's instant to the pinned clock", () => {
    // The transport defaults `validAt` to ZERO, so an omitted instant is not
    // "now": it is a sample from the epoch, which reads as maximally stale.
    const pkg = resolveUplinkPackage(
      fixture({
        _scene: { widget: "reactor" },
        _stream: {
          pinnedUt: 500,
          emits: [{ topic: "example.reactor", payload: {} }],
        },
      }),
    );
    const [scene] = buildScenes(pkg, INVENTORY);
    expect(scene.emits[0].validAt).toBe(500);
  });
});

describe("coverage of the registrations", () => {
  it("fails when a registered widget has no fixture", () => {
    expect(() => assertEveryWidgetCovered([], INVENTORY)).toThrow(
      /1 widget\(s\) have no fixture/,
    );
  });

  it("names the scenes that assert nothing about their own render", () => {
    const scene = (name: string, paints: string[]) =>
      ({
        file: `${name}.json`,
        name,
        target: { kind: "augment", id: "overlay" },
        paints,
        before: [],
        pinnedUt: 0,
        emits: [],
      }) as never;

    const named = scenesAssertingNothing({
      scenes: [scene("silent", []), scene("speaks", ["READY"])],
    } as never);

    // A scene with no `paints` still renders and still gets looked at, so this
    // WARNS rather than failing. But it asserts nothing about what the render
    // says, and `paints` is the mechanism that catches a sentence which silently
    // stopped appearing: it is how the RP-1 dismantle warning was found sitting
    // behind a branch a fresh complex could never reach.
    expect(named).toEqual(["overlay / silent"]);
  });

  it("reports an unpreviewed augment rather than failing on it", () => {
    const withAugment: UplinkInventory = {
      ...INVENTORY,
      widgets: [],
      augments: [
        {
          id: "overlay",
          augments: "map-view.overlay",
          channels: [],
          suppressesVanillaBase: false,
          settings: [],
        },
      ],
    };
    // An overlay augment draws in its host's projection, so a stand-in panel
    // gives it nothing to draw against: demanding a fixture would be demanding
    // a picture that cannot be honest.
    expect(assertEveryWidgetCovered([], withAugment).unpreviewed).toEqual([
      "augment:overlay",
    ]);
  });
});

describe("the README docs is about to overwrite", () => {
  const readmeOf = (dir: string) => join(dir, "README.md");

  it("writes over the one it generated last time", async () => {
    const dir = fakePackage({
      "README.md": `${README_GENERATED_MARKER} Do not edit this file. -->\n\n# Example\n`,
    });
    await expect(
      refuseToClobberHandWrittenReadme(dir, readmeOf(dir)),
    ).resolves.toBeUndefined();
  });

  it("writes one where there is none", async () => {
    const dir = fakePackage({});
    await expect(
      refuseToClobberHandWrittenReadme(dir, readmeOf(dir)),
    ).resolves.toBeUndefined();
  });

  /* Everything a generated page says comes from the registrations, so there is
     nowhere in it for prose to survive: overwriting a readme a person wrote
     destroys it outright, and before this the first run in such a package did
     exactly that with no warning. */
  it("refuses a hand-written one, naming what to do with it", async () => {
    const dir = fakePackage({
      "README.md": "# My Uplink\n\nNotes I spent an afternoon on.\n",
    });
    await expect(
      refuseToClobberHandWrittenReadme(dir, readmeOf(dir)),
    ).rejects.toThrow(/was not written by this command[\s\S]*git mv/);
  });
});

/**
 * There is no authored prose file any more, and the cases that covered one are
 * gone with it.
 *
 * `uplink.md` was the one file an author wrote, and its per-registration
 * `## widget:<id>` sections were a second, longer answer to a question the
 * registration's own description already answers. The whole prose surface was
 * removed: what the page needs from an author is one FIELD, `description` on
 * `defineUplinkClient`, and `buildReadme` refuses a page without it. A field has
 * a shape; a markdown file has whatever someone types.
 */

describe("frames become an animation", () => {
  /** A minimal 2x2 RGBA PNG, encoded here so the decoder is tested against
   *  bytes rather than against itself. */
  function tinyPng(): Buffer {
    const raw = Buffer.alloc(2 * (1 + 2 * 4));
    // Two rows, filter byte 0 (none), four RGBA pixels.
    raw.writeUInt8(0, 0);
    raw.fill(0xff, 1, 9);
    raw.writeUInt8(0, 9);
    raw.fill(0x40, 10, 18);
    const chunk = (type: string, body: Buffer) => {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(body.length);
      const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(typed));
      return Buffer.concat([length, typed, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(2, 0);
    ihdr.writeUInt32BE(2, 4);
    ihdr.writeUInt8(8, 8);
    ihdr.writeUInt8(6, 9);
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }

  function crc32(buf: Buffer): number {
    let c = 0xffffffff;
    for (const byte of buf) {
      c ^= byte;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  it("decodes a PNG to RGBA", () => {
    const png = decodePng(tinyPng());
    expect(png.width).toBe(2);
    expect(png.height).toBe(2);
    expect(png.data.length).toBe(2 * 2 * 4);
    expect([...png.data.slice(0, 4)]).toEqual([255, 255, 255, 255]);
    expect([...png.data.slice(8, 12)]).toEqual([64, 64, 64, 64]);
  });

  it("writes a GIF a reader would recognise", () => {
    const gif = encodeGif([tinyPng(), tinyPng()], { fps: 12, pingPong: false });
    expect(gif.subarray(0, 6).toString("ascii")).toBe("GIF89a");
  });

  it("refuses frames of different sizes rather than stitching a slideshow", () => {
    const wrong = decodePng(tinyPng());
    expect(wrong.width).toBe(2);
    expect(() =>
      encodeGif([tinyPng(), Buffer.from([0x89, 0x50])], {
        fps: 12,
        pingPong: false,
      }),
    ).toThrow();
  });
});
