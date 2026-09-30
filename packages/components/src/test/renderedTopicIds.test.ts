import { describe, expect, it } from "vitest";
import { renderedTopicIds } from "./renderedTopicIds";

function mounted(html: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

describe("renderedTopicIds", () => {
  it("finds a Topic id in text, in a hover title and under a dynamic suffix", () => {
    expect(
      renderedTopicIds(
        mounted(
          `<p>waiting on vessel.orbit</p><span title="input @system.bodies">x</span><i aria-label="system.bodies.3">y</i>`,
        ),
      ).sort(),
    ).toEqual(["system.bodies", "system.bodies.3", "vessel.orbit"]);
  });

  it("passes prose, figures and abbreviations", () => {
    expect(
      renderedTopicIds(
        mounted(
          "<p>orbit 1.5 km, e.g. the vessel. Orbit decays; comms delay 2.0 s</p>",
        ),
      ),
    ).toEqual([]);
  });
});
