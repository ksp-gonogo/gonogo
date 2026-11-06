import { railTagsForTelemetry } from "@ksp-gonogo/sitrep-sdk";
import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { createDelayRailStore, DelayRailContext } from "./DelayRailContext";
import { PanelDelayRail } from "./PanelDelayRail";

function voiceRail(oneWaySeconds: number) {
  const store = createDelayRailStore();
  store.register({
    id: "voice",
    inFlight: [],
    tags: railTagsForTelemetry("continuous"),
    effectiveDelaySeconds: oneWaySeconds,
    ribbons: [
      {
        id: "radio.voice",
        label: "voice",
        oneWaySeconds,
        amplitudes: [0.5],
        spanSamples: 250,
        tags: railTagsForTelemetry("continuous"),
      },
    ],
  });
  return render(
    <DelayRailContext.Provider value={store}>
      <PanelDelayRail />
    </DelayRailContext.Provider>,
  );
}

describe("PanelDelayRail voice ribbon", () => {
  it("draws the ribbon for a sub-second one-way delay", () => {
    const { container } = voiceRail(0.04);
    expect(container.querySelector('[data-role="ribbon"]')).not.toBeNull();
  });

  it("draws the ribbon for a delay of a few nanoseconds, as between a pad and its centre", () => {
    const { container } = voiceRail(1.5e-8);
    const ribbon = container.querySelector('[data-role="ribbon"]');
    expect(ribbon).not.toBeNull();
    expect(ribbon?.getAttribute("d") ?? "").not.toMatch(/NaN|Infinity/);
  });

  it("mounts no empty strip where there is no delay at all", () => {
    const { container } = voiceRail(0);
    expect(container.querySelector("[data-panel-rail]")).toBeNull();
  });
});
