import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import padCraftParts from "./__fixtures__/pad-craft-parts.json";
import { LaunchDirectorComponent } from "./index";

afterEach(() => {
  clearActionHandlers();
});

type Emit = { channel: string; value: unknown };
const EMITS = padCraftParts._stream.emits as Emit[];
const PARTS_PREFIX = "spaceCenter.craft.";
const WAVE_TOPIC = "spaceCenter.craft.VAB.LFV-2%20Wave.parts";
const PROBE_TOPIC = "spaceCenter.craft.VAB.Wave%20Probe.parts";
const RELAY_TOPIC = "spaceCenter.craft.VAB.Relay%20A.parts";

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

const isParts = (e: Emit) => e.channel.startsWith(PARTS_PREFIX);

/** The craft names in the order the list shows them. */
const listed = () =>
  [...document.querySelectorAll("[data-ship-row]")].map(
    (row) => row.querySelector("span span")?.textContent,
  );

describe("LaunchDirector: the open pad's craft and the picked craft's side view", () => {
  it("lists a pad's launchable craft, most recently launched first, and the never-launched by name", async () => {
    const { emit } = mount(14, 16);
    emit((e) => !isParts(e));
    await screen.findByText("LFV-2 Wave");

    // The SPH craft belongs to the runway, so the pad does not offer it.
    expect(listed()).toEqual([
      "LFV-2 Wave",
      "LFV-2 Wave Probe",
      "Alpha Lifter",
      "Kerbin Relay A",
    ]);
    expect(screen.getByText(/31 parts/)).toBeTruthy();
  });

  it("marks a launch found by matching the craft name against a vessel in the save", async () => {
    const { emit } = mount(14, 16);
    emit((e) => !isParts(e));
    await screen.findByText("LFV-2 Wave");

    const rows = [...document.querySelectorAll("[data-ship-row]")];
    expect(rows[0].textContent).toContain("launched");
    expect(rows[0].textContent).not.toContain("by name");
    expect(rows[1].textContent).toContain("(by name)");
    expect(rows[2].textContent).not.toContain("launched");
  });

  it("says when each craft was launched, in the game's date format", async () => {
    const { emit } = mount(14, 16);
    emit((e) => !isParts(e));
    await screen.findByText("LFV-2 Wave");

    const rows = [...document.querySelectorAll("[data-ship-row]")];
    expect(rows[0].textContent).toMatch(/launched Y\d+ D\d+ \d\d:\d\d:\d\d/);
    expect(rows[1].textContent).toMatch(
      /launched Y\d+ D\d+ \d\d:\d\d:\d\d \(by name\)/,
    );
  });

  it("narrows the list as the operator types, then shows the picked craft's parts", async () => {
    const user = userEvent.setup();
    const { fixture, view, emit } = mount(14, 16);
    emit((e) => !isParts(e));
    const search = await screen.findByRole("searchbox", {
      name: "Search craft",
    });

    await user.type(search, "wave");
    expect(listed()).toEqual(["LFV-2 Wave", "LFV-2 Wave Probe"]);
    await user.type(search, " probe");
    expect(listed()).toEqual(["LFV-2 Wave Probe"]);

    // Nothing is opened until a craft is picked.
    expect(fixture.transport.isSubscribed(PROBE_TOPIC)).toBe(false);
    await user.click(screen.getByText("LFV-2 Wave Probe"));
    expect(fixture.transport.isSubscribed(PROBE_TOPIC)).toBe(true);
    expect(fixture.transport.isSubscribed(WAVE_TOPIC)).toBe(false);

    emit(isParts);
    const diagram = await screen.findByLabelText("Ship diagram");
    expect(diagram.querySelectorAll("g[transform]").length).toBeGreaterThan(1);
    expect(diagram.textContent).not.toContain("No vessel topology yet.");
    expect(screen.getByText(/Launch LFV-2 Wave Probe/)).toBeTruthy();
    await expectNoA11yViolations(view.container);
  });

  it("keys the craft's topic by its facility, so the runway's craft is read from the SPH", async () => {
    const user = userEvent.setup();
    const { fixture, emit } = mount(14, 16);
    emit((e) => !isParts(e));
    await user.click(await screen.findByText("KSC Runway"));

    expect(listed()).toEqual(["Aeris 3A"]);
    await user.click(screen.getByText("Aeris 3A"));
    expect(
      fixture.transport.isSubscribed("spaceCenter.craft.SPH.Aeris%203A.parts"),
    ).toBe(true);
    expect(fixture.transport.isSubscribed(WAVE_TOPIC)).toBe(false);
  });

  it("draws the absence dash for a craft the mod has sent no parts for", async () => {
    const { fixture, emit } = mount(14, 16);
    emit((e) => !isParts(e));
    fireEvent.click(await screen.findByText("Kerbin Relay A"));

    expect(fixture.transport.isSubscribed(RELAY_TOPIC)).toBe(true);
    expect(
      await screen.findByRole("img", { name: "No part data for this craft" }),
    ).toBeTruthy();
  });

  it("offers no part actions: no part is focusable and clicking one sends nothing", async () => {
    const { fixture, emit } = mount(14, 16);
    emit((e) => !isParts(e));
    fireEvent.click(await screen.findByText("LFV-2 Wave"));
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
  });

  it("below 9 columns by 12 rows keeps the list as it was and opens no craft file", async () => {
    const { fixture, view, emit } = mount(8, 12);
    emit((e) => !isParts(e));
    await screen.findByText("LFV-2 Wave");

    expect(listed()).toEqual([
      "Kerbin Relay A",
      "Alpha Lifter",
      "LFV-2 Wave Probe",
      "LFV-2 Wave",
    ]);
    expect(view.container.querySelector("[data-craft-map]")).toBeNull();
    fireEvent.click(screen.getByText("LFV-2 Wave"));
    expect(fixture.transport.isSubscribed(WAVE_TOPIC)).toBe(false);
    expect(document.body.textContent).not.toContain("launched");
  });

  it("is not shown on a tile wide enough but too short", async () => {
    const { view, emit } = mount(14, 11);
    emit((e) => !isParts(e));
    await screen.findByText("LFV-2 Wave");
    expect(view.container.querySelector("[data-craft-map]")).toBeNull();
  });
});
