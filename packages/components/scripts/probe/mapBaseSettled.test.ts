// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mapBaseSettled } from "./mapBaseSettled";

function mountPendingMap(): { root: HTMLElement; canvas: HTMLCanvasElement } {
  const root = document.createElement("div");
  const canvas = document.createElement("canvas");
  canvas.dataset.mapBase = "pending";
  root.append(canvas);
  return { root, canvas };
}

describe("mapBaseSettled", () => {
  it("stays pending across frames until the canvas reports its paint", async () => {
    const { root, canvas } = mountPendingMap();
    let settled = false;
    const done = mapBaseSettled(root).then(() => {
      settled = true;
    });

    // The frames the harness used to wait for before the screenshot.
    await new Promise((r) => setTimeout(r, 50));
    expect(settled).toBe(false);

    canvas.dataset.mapBase = "textured";
    await done;
    expect(settled).toBe(true);
  });

  it("resolves at once when the page has no map", async () => {
    await expect(mapBaseSettled(document.createElement("div"))).resolves.toBe(
      undefined,
    );
  });

  it("fails when a map never paints", async () => {
    const { root } = mountPendingMap();
    await expect(mapBaseSettled(root, 20)).rejects.toThrow(/never finished/);
  });
});
