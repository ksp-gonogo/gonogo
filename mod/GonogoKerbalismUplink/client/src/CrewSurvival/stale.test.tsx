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
import rising from "./__fixtures__/radiation-rising.json";
import risingHeld from "./__fixtures__/radiation-rising-stopped-arriving.json";
import risingLater from "./__fixtures__/radiation-rising-stopped-arriving-later.json";
import { survivalBadges, survivalBadgesFor } from "./badge";
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
  return visibleText(await rowBadgeTree(fixture));
}

async function rowBadgeTree(
  fixture: Record<string, unknown>,
): Promise<HTMLElement> {
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
  return container;
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
    expect(survivalBadges(survival, "held")?.[0]?.label).toBe(
      "Critical · held",
    );
    expect(survivalBadges(survival, "modelled")?.[0]?.label).toBe(
      "Crit (modelled)",
    );
    expect(survivalBadges(survival)?.[0]?.label).toBe("Crew critical");
  });

  /**
   * A dose that was climbing before the link dropped keeps climbing, carried by
   * the crew model's own fit of that climb, so a badge can arrive after contact
   * loss. The death clock beside it is Kerbalism's deadline from its last turn
   * and is never carried, so it stays held.
   */
  describe("a trend carried past contact loss", () => {
    it("holds the death clock and has nothing critical to carry yet", async () => {
      const tree = await rowBadgeTree(risingHeld);
      const text = visibleText(tree);
      expect(text).toMatch(/to fatal · held/i);
      expect(text).not.toMatch(/radiation dose critical/i);
      expect(tree.querySelectorAll("[data-reckoning-basis]")).toHaveLength(0);
    });

    it("raises the dose badge once the carried dose crosses the line, and says it is modelled", async () => {
      const tree = await rowBadgeTree(risingLater);
      expect(visibleText(tree)).toMatch(
        /radiation dose critical \(modelled\)/i,
      );
      expect(visibleText(tree)).toMatch(/to fatal · held/i);
      const modelled = [...tree.querySelectorAll("[data-reckoning-basis]")];
      expect(
        modelled.map((el) => el.getAttribute("data-reckoning-basis")),
      ).toEqual(["rate-integration"]);
    });

    it("draws the live trend with no mark at all", async () => {
      const tree = await rowBadgeTree(rising);
      expect(visibleText(tree)).not.toMatch(/· held|\(modelled\)/i);
      expect(tree.querySelectorAll("[data-reckoning-basis]")).toHaveLength(0);
    });
  });

  describe("the panel badge's count", () => {
    const kerbal = (
      name: string,
      deathClockSec: number | null,
      worst: { fraction: number; carried?: boolean },
    ) => ({
      name,
      trait: "Pilot",
      rules: [{ name: "radiation", ...worst }],
      worstRule: { name: "radiation", ...worst },
      deathClockSec,
      tone: "nogo" as const,
    });

    it("is modelled when a carried rule is what makes someone critical", () => {
      const label = survivalBadgesFor({
        survival: {
          kerbals: [
            kerbal("Jebediah Kerman", null, { fraction: 0.83, carried: true }),
            kerbal("Bill Kerman", 120, { fraction: 0.2 }),
          ],
          soonestDeathClockSec: 120,
          basis: "rate-integration",
        },
        stale: true,
        basis: "rate-integration",
      })?.[0]?.label;
      expect(label).toBe("2 crit (modelled)");
    });

    it("is held when every critical kerbal would be counted without the model", () => {
      const label = survivalBadgesFor({
        survival: {
          kerbals: [kerbal("Bill Kerman", 240, { fraction: 0.2 })],
          soonestDeathClockSec: 240,
          basis: "rate-integration",
        },
        stale: true,
        basis: "rate-integration",
      })?.[0]?.label;
      expect(label).toBe("Critical · held");
    });
  });
});
