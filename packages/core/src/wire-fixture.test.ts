// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertNoHomePaths,
  dedupeWireFixture,
  readWireFixture,
  scrubWireFixture,
  type WireRow,
  writeWireFixture,
} from "../../../tests/playwright/wire-fixture.mjs";

/**
 * A wire recording is committed as a test fixture, so it has to stay small
 * enough to review and must not carry the machine it was recorded on.
 */

function data(topic: string, payload: unknown, validAt: number): WireRow {
  return {
    t: validAt * 1000,
    frame: {
      type: "stream-data",
      topic,
      payload,
      meta: { validAt, deliveredAt: validAt },
    },
  };
}

describe("dedupeWireFixture", () => {
  it("keeps the first frame of a topic and drops each unchanged repeat", () => {
    const rows = [
      data("vessel.flight", { alt: 10 }, 0),
      data("vessel.flight", { alt: 10 }, 1),
      data("vessel.flight", { alt: 10 }, 2),
      data("vessel.flight", { alt: 11 }, 3),
      data("vessel.flight", { alt: 11 }, 4),
    ];
    expect(dedupeWireFixture(rows).map((row) => row.t)).toEqual([0, 3000]);
  });

  it("judges each topic against its own previous frame", () => {
    const rows = [
      data("a", { v: 1 }, 0),
      data("b", { v: 1 }, 0),
      data("a", { v: 1 }, 1),
      data("b", { v: 2 }, 1),
    ];
    expect(
      dedupeWireFixture(rows).map((row) => [row.frame.topic, row.t]),
    ).toEqual([
      ["a", 0],
      ["b", 0],
      ["b", 1000],
    ]);
  });

  it("keeps a frame that returns to an earlier payload", () => {
    const rows = [
      data("a", { v: 1 }, 0),
      data("a", { v: 2 }, 1),
      data("a", { v: 1 }, 2),
    ];
    expect(dedupeWireFixture(rows)).toHaveLength(3);
  });

  it("keeps an unchanged frame once the topic has been quiet for the keepalive", () => {
    const rows = [
      data("trackingStation.bodies", { n: 1 }, 0),
      data("trackingStation.bodies", { n: 1 }, 9),
      data("trackingStation.bodies", { n: 1 }, 10),
      data("trackingStation.bodies", { n: 1 }, 12),
    ];
    expect(dedupeWireFixture(rows).map((row) => row.t)).toEqual([0, 10000]);
  });

  it("passes every other frame type through, repeats included", () => {
    const hello = { t: 0, frame: { type: "hello", modVersion: "1" } };
    const state = { t: 0, frame: { type: "game-state", scene: "FLIGHT" } };
    const event = {
      t: 1,
      frame: { type: "event", topic: "a", name: "x", meta: { validAt: 1 } },
    };
    const error = {
      t: 2,
      frame: { type: "error", topic: "a.b", code: "unknownTopic" },
    };
    const rows = [hello, state, state, event, event, error, error];
    expect(dedupeWireFixture(rows)).toEqual(rows);
  });
});

const HOME = ["", "home", "someone"].join("/");

describe("scrubWireFixture", () => {
  const settings = (path: string) =>
    data("settings.gonogo", { persistence: { path } }, 0);

  it("rewrites the game's install path under a home folder", () => {
    const [row] = scrubWireFixture([
      settings(
        `${HOME}/.local/share/Steam/steamapps/common/Kerbal Space Program/KSP_Data/../GameData/Gonogo/PluginData/gonogo.cfg`,
      ),
    ]);
    expect(row.frame.payload).toEqual({
      persistence: {
        path: "/games/ksp/Kerbal Space Program/KSP_Data/../GameData/Gonogo/PluginData/gonogo.cfg",
      },
    });
    expect(() => assertNoHomePaths([row])).not.toThrow();
  });

  it("also rewrites a macOS install path", () => {
    const [row] = scrubWireFixture([
      settings(
        `${["", "Users", "someone"].join("/")}/Games/Kerbal Space Program/GameData/x.cfg`,
      ),
    ]);
    expect(row.frame.payload).toEqual({
      persistence: { path: "/games/ksp/Kerbal Space Program/GameData/x.cfg" },
    });
  });

  it("leaves a frame with no home folder untouched", () => {
    const row = data("a", { v: 1 }, 0);
    expect(scrubWireFixture([row])[0]).toBe(row);
  });
});

describe("a home folder path in a recording", () => {
  const stray = data("settings.gonogo", { log: `${HOME}/notes.txt` }, 0);

  it("fails the check", () => {
    expect(() => assertNoHomePaths([stray])).toThrow(/home folder path/);
  });

  it("is refused when the recording is written, and nothing is written", () => {
    const dir = mkdtempSync(join(tmpdir(), "wire-fixture-"));
    try {
      expect(() => writeWireFixture(join(dir, "out.jsonl"), [stray])).toThrow(
        /home folder path/,
      );
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is not in any committed recording", () => {
    const folder = join(import.meta.dirname, "../../../tests/fixtures/wire");
    for (const name of readdirSync(folder)) {
      expect(() =>
        assertNoHomePaths(readWireFixture(join(folder, name))),
      ).not.toThrow();
    }
  });
});

describe("committed recordings", () => {
  const root = join(import.meta.dirname, "../../../");
  const folder = join(root, "tests/fixtures/wire");
  const source = readFileSync(
    join(root, "mod/Sitrep.Contract/ContractVersion.cs"),
    "utf8",
  );
  const declared = (name: "Major" | "Minor"): number =>
    Number(
      new RegExp(`public\\s+const\\s+int\\s+${name}\\s*=\\s*(\\d+)`).exec(
        source,
      )?.[1],
    );

  it("carry the contract major the app speaks and no minor ahead of it", () => {
    const major = declared("Major");
    const minor = declared("Minor");
    expect(Number.isInteger(major) && Number.isInteger(minor)).toBe(true);
    for (const name of readdirSync(folder)) {
      const hello = readWireFixture(join(folder, name)).find(
        (row) => row.frame.type === "hello",
      )?.frame;
      const recorded = `${hello?.contractMajor}.${hello?.contractMinor}`;
      const current =
        hello?.contractMajor === major &&
        typeof hello.contractMinor === "number" &&
        hello.contractMinor <= minor;
      expect(
        current,
        `${name} was recorded on contract ${recorded} but ContractVersion.cs is ${major}.${minor}. A replay shows "Update the mod" when the major differs or the minor is ahead of the app; a minor behind it replays fine. Re-record it on the rig and cut it with tests/playwright/wire-fixture.mjs trim`,
      ).toBe(true);
    }
  });
});
