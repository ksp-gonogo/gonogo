// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CheckUnableError } from "../program";
import { sweepMinSize } from "./minsize";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true });
});

const WIDE_TITLE =
  "A TITLE FAR TOO LONG FOR ANY TILE THIS SMALL TO HOLD WITHOUT CLIPPING IT";

const widget = (id: string) => `
import { registerComponent } from "@ksp-gonogo/sitrep-sdk";
import { Panel } from "@ksp-gonogo/ui-kit";
registerComponent({
  id: "${id}",
  name: "${id}",
  description: "Too small on purpose.",
  tags: ["test"],
  component: () => <Panel panelTitle="${WIDE_TITLE}">x</Panel>,
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 2, h: 2 },
});
`;

/** A client inside this package so its bare specifiers resolve like a real one. */
function client(): string {
  const root = join(process.cwd(), ".tmp-x");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "minsize-"));
  made.push(dir);
  mkdirSync(join(dir, "src"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "@example/uplink",
      version: "1.0.0",
      gonogo: { renderWith: ["./host.tsx"] },
    }),
  );
  writeFileSync(join(dir, "host.tsx"), widget("core-host"));
  writeFileSync(join(dir, "src", "index.tsx"), widget("client-widget"));
  return dir;
}

describe("sweepMinSize", () => {
  it("fails the client's own undersized widget and spares a bundled core host", async () => {
    let result: Awaited<ReturnType<typeof sweepMinSize>>;
    try {
      result = await sweepMinSize(client());
    } catch (err) {
      if (
        err instanceof CheckUnableError &&
        /no browser|playwright/i.test(err.message)
      )
        return;
      throw err;
    }
    expect(result.misfits.map((m) => m.widget.id)).toEqual(["client-widget"]);
    expect(result.swept).toBe(1);
  }, 120_000);
});
