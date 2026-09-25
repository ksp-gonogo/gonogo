import { render, setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import {
  ContributionsProvider,
  WidgetMetaContext,
  WidgetMeters,
} from "@ksp-gonogo/ui-kit";
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

/**
 * One kerbal's meter stack over a scene, mounted the way CrewStatus mounts it:
 * the widget identity, the contribution aggregation and ui-kit's `WidgetMeters`.
 */
async function meterTree(
  fixture: Record<string, unknown>,
  row: string,
): Promise<HTMLElement> {
  const block = resolveStreamBlock(fixture);
  if (!block) throw new Error("fixture carries no _stream block");
  const stream = setupStreamFixture({
    carriedChannels: block.emits.map((e) => e.topic),
    pinnedUt: block.pinnedUt,
  });
  for (const e of block.emits) stream.subscribe(e.topic);
  const { container, unmount } = render(
    <stream.Provider>
      <WidgetMetaContext.Provider
        value={{ componentId: "crew-status", contributionSlots: [] }}
      >
        <ContributionsProvider>
          <WidgetMeters row={row} />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </stream.Provider>,
  );
  unmounts.push(unmount);
  await replayStreamBlock(stream, block);
  await flushProviderFrame();
  return container;
}

/** The meter labelled `label` inside `tree`, and the parts that say what it draws. */
function meterParts(tree: HTMLElement, label: string) {
  const track = [...tree.querySelectorAll("[role=meter]")].find(
    (el) => el.getAttribute("aria-label") === label,
  );
  const root = track?.parentElement?.parentElement;
  if (!track || !root) throw new Error(`no meter labelled ${label}`);
  const fill = track.firstElementChild as HTMLElement | null;
  return {
    root,
    header: visibleText(root.firstElementChild as HTMLElement),
    fillWidth: fill?.style.width,
    fillDimmed: fill?.hasAttribute("data-fill-not-current") ?? false,
    notCurrentMark: root.querySelector("[data-not-current-mark]"),
    bounds: [...root.querySelectorAll("[data-bound]")].map(
      (el) => (el as HTMLElement).style.left,
    ),
  };
}

/**
 * The dose meter two minutes after contact loss. The crew model has carried
 * Jebediah's dose from 78 % to 83 %, and the meter must not draw that 83 % as
 * though anybody observed it: the bar stays at the last observation, marked,
 * and the model's figure is the pair of marks on the track.
 */
describe("the dose meter over a carried trend", () => {
  it("draws the held observation, marked, with the model's marks where the dose is carried to", async () => {
    const tree = await meterTree(risingLater, "Jebediah Kerman");
    const dose = meterParts(tree, "Radiation dose");

    expect(dose.fillWidth).toBe("78%");
    expect(dose.fillDimmed).toBe(true);
    expect(dose.notCurrentMark).not.toBeNull();
    expect(dose.header).toMatch(/^Radiation dose\s*78\s*%\s*\(~83\s*%\)$/);
    expect(dose.bounds).toHaveLength(2);
    for (const left of dose.bounds) {
      expect(Number.parseFloat(left ?? "")).toBeCloseTo(82.8, 0);
    }
  });

  it("draws a live reading as the observation, with no held mark", async () => {
    const tree = await meterTree(rising, "Jebediah Kerman");
    const dose = meterParts(tree, "Radiation dose");

    expect(dose.fillWidth).toBe("78%");
    expect(dose.fillDimmed).toBe(false);
    expect(dose.notCurrentMark).toBeNull();
    expect(dose.header).toMatch(/^Radiation dose\s*78\s*%$/);
  });
});

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
      "Crit · modelled",
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
      expect(visibleText(tree)).toMatch(/radiation dose critical · modelled/i);
      expect(visibleText(tree)).toMatch(/to fatal · held/i);
      const modelled = [...tree.querySelectorAll("[data-reckoning-basis]")];
      expect(
        modelled.map((el) => el.getAttribute("data-reckoning-basis")),
      ).toEqual(["rate-integration"]);
    });

    it("draws the live trend with no mark at all", async () => {
      const tree = await rowBadgeTree(rising);
      expect(visibleText(tree)).not.toMatch(/· held|· modelled/i);
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
      expect(label).toBe("2 crit · modelled");
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
