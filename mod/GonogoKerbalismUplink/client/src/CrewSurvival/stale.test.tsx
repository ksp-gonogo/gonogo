import { render, setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  flushProviderFrame,
  replayStreamBlock,
  resolveStreamBlock,
} from "../test/widgetDomSnapshot";
import live from "./__fixtures__/radiation-dose-critical.json";
import held from "./__fixtures__/radiation-dose-critical-stopped-arriving.json";
import { survivalBadges } from "./badge";
import { CrewSurvivalBadgeAugment } from "./index";
import type { CrewSurvival } from "./processor";

/**
 * The survival badges when the link drops out of a scene with a kerbal inside
 * a death clock. The host marks its own figures in the same row, so a badge
 * left unmarked there would read as current on the strength of theirs.
 *
 * The badge says it is held in words rather than by a change of colour, which
 * a reader who cannot tell the two badges apart by hue would not see.
 */

const CREW = ["Jebediah Kerman", "Bill Kerman", "Bob Kerman"];

const unmounts: Array<() => void> = [];
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

async function rowBadges(fixture: Record<string, unknown>): Promise<string> {
  const block = resolveStreamBlock(fixture);
  if (!block) throw new Error("fixture carries no _stream block");
  const stream = setupStreamFixture({
    carriedChannels: block.emits.map((e) => e.topic),
    pinnedUt: block.pinnedUt,
  });
  /*
   * `useProcessor` reads its inputs straight off the store and never
   * subscribes, and `StubTransport.emit` drops a sample for a topic nobody
   * has, so the scene's own topics are subscribed here.
   */
  for (const e of block.emits) stream.subscribe(e.topic);
  const { container, unmount } = render(
    <stream.Provider>
      {CREW.map((name, index) => (
        <CrewSurvivalBadgeAugment
          key={name}
          crewName={name}
          crewIndex={index}
        />
      ))}
    </stream.Provider>,
  );
  unmounts.push(unmount);
  await replayStreamBlock(stream, block);
  await flushProviderFrame();
  return visibleText(container);
}

describe("the survival badges say a held death clock is held", () => {
  it("marks every row badge once the link drops", async () => {
    const text = await rowBadges(held);
    expect(text).toMatch(/to fatal · held/i);
    expect(text).toMatch(/radiation dose critical · held/i);
  });

  it("carries no mark while the crew reading is current", async () => {
    const text = await rowBadges(live);
    expect(text).toMatch(/to fatal/i);
    expect(text).not.toMatch(/· held/i);
  });

  it("marks the panel badge the same way", () => {
    const survival: CrewSurvival = {
      kerbals: [
        {
          name: "Jebediah Kerman",
          trait: "Pilot",
          rules: [],
          worstRule: undefined,
          deathClockSec: 240,
          tone: "nogo",
        },
      ],
      soonestDeathClockSec: 240,
    };
    expect(survivalBadges(survival, true)?.[0]?.label).toBe("Critical · held");
    expect(survivalBadges(survival)?.[0]?.label).toBe("Crew critical");
  });
});
