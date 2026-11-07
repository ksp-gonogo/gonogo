import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ContributionsProvider,
  PerfBudget,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TrackingStationComponent } from "./index";
import { followControlFrameProjectionId } from "./projection";

const KERBIN_INDEX = 1;
const INTEGRATED = 2;
const UNTIL = 2;

const WIDGET_META = {
  componentId: "tracking-station",
  contributionSlots: ["tracking-station.projection"] as const,
};

interface Emit {
  channel: string;
  value: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

/** The recorded rotating-frame stream, with the craft's horizon swapped for an integrating provider's so its path is a sampled arc. */
function integratedEmits(): Emit[] {
  const parsed: unknown = JSON.parse(
    readFileSync(
      join(__dirname, "__fixtures__/rotating-kerbin-mun-frame.json"),
      "utf8",
    ),
  );
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("the rotating-frame fixture is not a JSON object");
  }
  const { _stream } = parsed as { _stream: { emits: Emit[] } };
  return _stream.emits.map((e) =>
    e.channel === "vessel.orbit"
      ? {
          ...e,
          value: {
            ...e.value,
            horizon: { kind: UNTIL, trajectoryKind: INTEGRATED, untilUt: 3000 },
          },
        }
      : e,
  );
}

describe("TrackingStation arc placement rate", () => {
  afterEach(() => vi.restoreAllMocks());

  it("places the craft's arc once, not on every frame inside one UT bucket", async () => {
    const budget = PerfBudget.getAll().find(
      (b) => b.name === "TrackingStation body placements/sec",
    );
    expect(budget).toBeDefined();
    const record = vi.spyOn(budget as PerfBudget, "record");

    const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
    const view = render(
      <fixture.Provider>
        <WidgetMetaContext.Provider value={WIDGET_META}>
          <ContributionsProvider>
            <TrackingStationComponent
              config={
                {
                  frame: "Kerbin",
                  projection: followControlFrameProjectionId(KERBIN_INDEX),
                } as never
              }
              id="sv"
            />
          </ContributionsProvider>
        </WidgetMetaContext.Provider>
      </fixture.Provider>,
    );
    const emits = integratedEmits();
    act(() => {
      for (const e of emits) fixture.emit(e.channel, e.value, e.meta);
    });
    await waitFor(() => {
      expect(
        view.container.querySelector('path[data-vessel-trajectory="arc"]'),
      ).not.toBeNull();
    });
    await act(async () => {});

    const frame = emits.find((e) => e.channel === "system.frame");
    const settled = record.mock.calls.length;
    for (let i = 0; i < 30; i++) {
      act(() => {
        fixture.emit("system.frame", frame?.value);
      });
    }
    await act(async () => {});

    expect(record.mock.calls.length - settled).toBe(0);
  });
  it("stays well under the placement budget while a live craft ticks every frame", async () => {
    const budget = PerfBudget.getAll().find(
      (b) => b.name === "TrackingStation body placements/sec",
    ) as PerfBudget;
    const record = vi.spyOn(budget, "record");
    let wallMs = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => wallMs);

    const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
    const view = render(
      <fixture.Provider>
        <WidgetMetaContext.Provider value={WIDGET_META}>
          <ContributionsProvider>
            <TrackingStationComponent
              config={
                {
                  frame: "Kerbin",
                  projection: followControlFrameProjectionId(KERBIN_INDEX),
                } as never
              }
              id="sv"
            />
          </ContributionsProvider>
        </WidgetMetaContext.Provider>
      </fixture.Provider>,
    );
    const emits = integratedEmits();
    act(() => {
      for (const e of emits) fixture.emit(e.channel, e.value, e.meta);
    });
    await waitFor(() => {
      expect(
        view.container.querySelector('path[data-vessel-trajectory="arc"]'),
      ).not.toBeNull();
    });
    await act(async () => {});

    const orbit = emits.find((e) => e.channel === "vessel.orbit");
    const settled = record.mock.calls.length;
    const seconds = 10;
    const framesPerSecond = 30;
    for (let i = 1; i <= seconds * framesPerSecond; i++) {
      wallMs += 1000 / framesPerSecond;
      const ut = i / framesPerSecond;
      act(() => {
        fixture.emit("vessel.orbit", orbit?.value, {
          validAt: ut,
          deliveredAt: ut,
        });
        fixture.scrubTo(ut);
      });
    }
    await act(async () => {});

    // The arc is 128 points placed once a UT bucket; placed on every frame it is about 4,000 a second here and grows with every body and patch.
    const perSecond = (record.mock.calls.length - settled) / seconds;
    expect(perSecond).toBeLessThan(budget.threshold / 20);
  });
});
