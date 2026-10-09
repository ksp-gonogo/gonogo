import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { listUplinkWidgets } from "./uplinkWidgets";

const SRC = resolve(__dirname, "../src");

describe("listUplinkWidgets", () => {
  it("lists the bundled Breaking Ground widgets", async () => {
    const ids = (await listUplinkWidgets()).map((c) => c.widgetId);
    expect(ids).toEqual(
      expect.arrayContaining([
        "deployed-science",
        "robotics-console",
        "rotor-tachometer",
      ]),
    );
  });

  it("points every config at a fixtures directory that exists", async () => {
    for (const config of await listUplinkWidgets()) {
      expect(existsSync(resolve(SRC, config.fixturesPath))).toBe(true);
    }
  });
});
