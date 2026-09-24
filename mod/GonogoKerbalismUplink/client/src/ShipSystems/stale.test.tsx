import { setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { renderWidget, visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  flushProviderFrame,
  replayStreamBlock,
  resolveStreamBlock,
} from "../test/widgetDomSnapshot";
import live from "./__fixtures__/ec-shortage-limits-water.json";
import held from "./__fixtures__/ec-shortage-limits-water-stopped-arriving.json";
// Side-effect import: the widget self-registers on module load.
import "./index";

/**
 * Ship Systems when the link drops out of a life-support scene: the same
 * ledger, drawn as the last one there was and saying so.
 *
 * The pair is the assertion. The scene is byte-for-byte its live twin but for
 * `stopsArriving`, so every held mark below is one the live scene must not
 * carry, and a harness that ignored the flag would render the two identically.
 */

const unmounts: Array<() => void> = [];
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

async function scene(fixture: Record<string, unknown>): Promise<HTMLElement> {
  const block = resolveStreamBlock(fixture);
  if (!block) throw new Error("fixture carries no _stream block");
  const stream = setupStreamFixture({
    carriedChannels: block.emits.map((e) => e.topic),
    pinnedUt: block.pinnedUt,
  });
  /*
   * `useProcessor` reads its inputs straight off the store and never
   * subscribes, and `StubTransport.emit` drops a sample for a topic nobody
   * has, so the scene's own topics are subscribed here the way a companion
   * widget would in production.
   */
  for (const e of block.emits) stream.subscribe(e.topic);
  const { container, unmount } = renderWidget("ship-systems", {
    instanceId: "stale",
    w: 8,
    h: 20,
    wrapper: stream.Provider,
  });
  unmounts.push(unmount);
  await replayStreamBlock(stream, block);
  await flushProviderFrame();
  return container;
}

describe("Ship Systems says a held ledger is held", () => {
  it("marks the header, the figures and the processes once the link drops", async () => {
    const container = await scene(held);
    const text = visibleText(container);

    expect(text).toMatch(/critical · held/i);
    expect(
      [...container.querySelectorAll("[role='status']")].some((el) =>
        /at last contact/i.test(el.textContent ?? ""),
      ),
    ).toBe(true);
    expect(text).toContain("run state held");
    expect(text).not.toMatch(/\brunning\b/i);
    expect(
      [...container.querySelectorAll("*")].filter(
        (el) => el.children.length === 0 && el.textContent === "held",
      ),
    ).toHaveLength(2);
    /*
     * The time-to-empty figures carry the kit's own mark, and it announces:
     * the dot is aria-hidden and the grade and instant are said beside it.
     */
    const marks = [...container.querySelectorAll("[data-not-current]")];
    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) {
      expect(mark.querySelector("[data-unit-currency]")).not.toBeNull();
    }
  });

  it("carries none of it while the ledger is current", async () => {
    const container = await scene(live);
    const text = visibleText(container);

    expect(text).not.toMatch(/at last contact|· held/i);
    expect(text).not.toContain("run state held");
    expect(container.querySelectorAll("[data-not-current]")).toHaveLength(0);
  });
});
