import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import launchedCraftParts from "./__fixtures__/launched-craft-parts.json";
import { LaunchDirectorComponent } from "./index";

afterEach(() => {
  clearActionHandlers();
});

type Emit = { channel: string; value: unknown };
const EMITS = launchedCraftParts._stream.emits as Emit[];
const PARTS_PREFIX = "trackingStation.vessel.";

function mount(w: number, h: number) {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "ld-craft-map" }}>
        <LaunchDirectorComponent id="ld-craft-map" w={w} h={h} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  const emit = (keep: (e: Emit) => boolean) =>
    act(() => {
      for (const e of EMITS.filter(keep)) fixture.emit(e.channel, e.value);
    });
  return { fixture, view, emit };
}

const isParts = (e: Emit) =>
  e.channel.startsWith(PARTS_PREFIX) && e.channel.endsWith(".parts");

describe("LaunchDirector: the launched craft's Ship Map", () => {
  it("below 9 columns by 12 rows shows no map and opens no craft's parts", async () => {
    const { fixture, emit } = mount(8, 12);
    emit((e) => !isParts(e));
    await screen.findByText("KSC Launch Pad");

    expect(screen.queryByRole("group", { name: "Launched craft" })).toBeNull();
    expect(fixture.transport.isSubscribed(`${PARTS_PREFIX}v-wave.parts`)).toBe(
      false,
    );
  });

  it("is not shown on a tile wide enough but too short", async () => {
    const { emit } = mount(14, 11);
    emit((e) => !isParts(e));
    await screen.findByText("KSC Launch Pad");
    expect(screen.queryByRole("group", { name: "Launched craft" })).toBeNull();
  });

  it("at 9 by 12 draws the first craft from its own parts topic, and only that craft's", async () => {
    const { fixture, view, emit } = mount(9, 12);
    emit((e) => !isParts(e));
    await screen.findByRole("group", { name: "Launched craft" });

    expect(fixture.transport.isSubscribed(`${PARTS_PREFIX}v-wave.parts`)).toBe(
      true,
    );
    expect(
      fixture.transport.isSubscribed(`${PARTS_PREFIX}v-wave-probe.parts`),
    ).toBe(false);

    emit(isParts);
    const diagram = await screen.findByLabelText("Ship diagram");
    expect(diagram.closest("[data-craft-map]")).toBe(
      view.container.querySelector("[data-craft-map]"),
    );
    expect(diagram.querySelectorAll("g[transform]").length).toBeGreaterThan(1);
    expect(diagram.textContent).not.toContain("No vessel topology yet.");
  });

  it("draws the absence dash for a craft never heard from", async () => {
    const { fixture, emit } = mount(14, 16);
    emit((e) => !isParts(e));
    const relay = await screen.findByRole("button", {
      name: /Kerbin Relay A/,
    });
    fireEvent.click(relay);

    expect(fixture.transport.isSubscribed(`${PARTS_PREFIX}v-relay.parts`)).toBe(
      true,
    );
    expect(
      await screen.findByRole("img", {
        name: "No part data for this craft",
      }),
    ).toBeTruthy();
  });

  it("offers no part actions: no part is focusable and clicking one sends nothing", async () => {
    const { fixture, view, emit } = mount(14, 16);
    emit((e) => !isParts(e));
    await screen.findByRole("group", { name: "Launched craft" });
    emit(isParts);
    const diagram = await screen.findByLabelText("Ship diagram");
    const map = diagram.closest("[data-craft-map]") as HTMLElement;

    // Only the view's own control to open crowded parts may take focus; no part does.
    const outsideClusters = (sel: string) =>
      [...map.querySelectorAll(sel)].filter(
        (el) => !el.closest('[data-role="cluster-layer"]'),
      );
    expect(outsideClusters("[tabindex]")).toEqual([]);
    expect(outsideClusters('[role="button"]')).toEqual([]);
    const part = diagram.querySelector("g[transform] g[transform]") as Element;
    fireEvent.click(part);
    fireEvent.contextMenu(part);
    expect(fixture.transport.sentCommands).toEqual([]);
    await expectNoA11yViolations(view.container);
  });
});
