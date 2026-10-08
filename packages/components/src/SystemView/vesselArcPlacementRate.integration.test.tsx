import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ContributionsProvider,
  PerfBudget,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";
import { followControlFrameProjectionId } from "./projection";

const KERBIN_INDEX = 1;
const INTEGRATED = 2;
const UNTIL = 2;

const WIDGET_META = {
  componentId: "system-view",
  contributionSlots: ["system-view.projection"] as const,
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

describe("SystemView arc placement rate", () => {
  it("places the craft's arc once, not on every frame inside one UT bucket", async () => {
    const budget = PerfBudget.getAll().find(
      (b) => b.name === "SystemView body placements/sec",
    );
    expect(budget).toBeDefined();
    const record = vi.spyOn(budget as PerfBudget, "record");

    const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
    const view = render(
      <fixture.Provider>
        <WidgetMetaContext.Provider value={WIDGET_META}>
          <ContributionsProvider>
            <SystemViewComponent
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
});
