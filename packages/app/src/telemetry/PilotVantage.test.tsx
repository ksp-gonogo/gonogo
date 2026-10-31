import { act, render } from "@ksp-gonogo/test-utils";
import { describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { PilotVantage } from "./PilotVantage";

const CRAFT = "vessel:abc-123";
const OTHER = "vessel:xyz-999";

function mountPilot() {
  const fixture = setupStreamFixture({ pinnedUt: 1_000 });
  const follow = vi.spyOn(fixture.client, "followActiveCraft");
  const setVantage = vi.spyOn(fixture.client, "setVantage");
  const view = render(
    <fixture.Provider>
      <PilotVantage />
    </fixture.Provider>,
  );
  return { ...fixture, ...view, follow, setVantage };
}

function emitOrbitFrom(
  fixture: ReturnType<typeof mountPilot>,
  source: string,
): void {
  act(() => {
    fixture.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: 1,
        sma: 700_000,
        ecc: 0.01,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        mu: 3.5316e12,
        meta: { source, quality: 0 },
      },
      { source: "system" },
    );
    fixture.store.beginFrame();
  });
}

describe("PilotVantage", () => {
  it("sends the follow request once, and names no craft", () => {
    const fixture = mountPilot();

    expect(fixture.follow).toHaveBeenCalledTimes(1);
    expect(fixture.setVantage).not.toHaveBeenCalled();

    fixture.unmount();
  });

  it("sends nothing when the active craft changes", () => {
    const fixture = mountPilot();

    emitOrbitFrom(fixture, CRAFT);
    emitOrbitFrom(fixture, OTHER);

    expect(fixture.follow).toHaveBeenCalledTimes(1);
    expect(fixture.setVantage).not.toHaveBeenCalled();

    fixture.unmount();
  });
});
