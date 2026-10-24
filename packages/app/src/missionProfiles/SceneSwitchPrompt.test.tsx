import {
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import {
  createFakeWallClock,
  StubTransport,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { act, fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import type { Layout } from "react-grid-layout";
import { describe, expect, it } from "vitest";
import type { DashboardItem } from "../components/Dashboard";
import { MissionProfilesProvider } from "./MissionProfilesContext";
import { MissionProfilesService } from "./MissionProfilesService";
import { ProfileDashboard } from "./ProfileDashboard";
import { SceneSwitchPrompt } from "./SceneSwitchPrompt";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    length: 0,
    clear: () => map.clear(),
    key: () => null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
  } as Storage;
}

const ITEMS: DashboardItem[] = [{ i: "a", componentId: "fuel-status" }];
const LAYOUT: Layout = [
  { i: "a", x: 0, y: 0, w: 8, h: 14, moved: false, static: false },
];

function setup() {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  clock.scrubTo(10);
  const svc = new MissionProfilesService("main", memoryStorage());
  const ascent = svc.save("Ascent", ITEMS, LAYOUT, ["Flight"]);
  const dashboard = new ProfileDashboard(svc, () => {}, {
    items: [],
    layout: [],
  });

  function Wrap({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider client={client} store={store}>
        <MissionProfilesProvider service={svc}>
          {children}
        </MissionProfilesProvider>
      </TelemetryProvider>
    );
  }
  render(
    <Wrap>
      <SceneSwitchPrompt dashboard={dashboard} />
    </Wrap>,
  );
  return {
    svc,
    ascent,
    emitScene: (scene: string) => {
      act(() => {
        transport.emit("spaceCenter.scene", { scene });
        store.beginFrame();
      });
    },
  };
}

describe("SceneSwitchPrompt", () => {
  it("does not prompt when a reload reads Unknown and then the bound scene", () => {
    const fixture = setup();

    fixture.emitScene("Flight");

    expect(screen.queryByRole("status")?.textContent ?? "").toBe("");
  });

  it("prompts, naming the scene, on a real change into a bound scene", () => {
    const fixture = setup();

    fixture.emitScene("SpaceCenter");
    fixture.emitScene("Flight");

    expect(screen.getByText("Now in flight: switch to Ascent?")).toBeTruthy();
  });

  it("makes the bound layout current when the prompt is accepted", () => {
    const fixture = setup();
    fixture.emitScene("SpaceCenter");
    fixture.emitScene("Flight");

    fireEvent.click(
      screen.getByRole("button", { name: "Switch to layout Ascent" }),
    );

    expect(fixture.svc.getCurrentId()).toBe(fixture.ascent.id);
  });

  it("does not prompt for a layout that is already current", () => {
    const fixture = setup();
    fixture.svc.setCurrent(fixture.ascent.id);

    fixture.emitScene("SpaceCenter");
    fixture.emitScene("Flight");

    expect(
      screen.queryByRole("button", { name: /Switch to layout/ }),
    ).toBeNull();
  });

  it("opens the auto-switch layout for the scene a screen with no current layout starts in", () => {
    const fixture = setup();
    fixture.svc.update(fixture.ascent.id, { autoSwitch: true });

    fixture.emitScene("Flight");

    expect(fixture.svc.getCurrentId()).toBe(fixture.ascent.id);
  });

  it("keeps the current layout when the screen starts in a bound scene", () => {
    const fixture = setup();
    fixture.svc.update(fixture.ascent.id, { autoSwitch: true });
    const mine = fixture.svc.save("Mine", ITEMS, LAYOUT);
    fixture.svc.setCurrent(mine.id);

    fixture.emitScene("Flight");

    expect(fixture.svc.getCurrentId()).toBe(mine.id);
  });
  describe("a reload at the Space Center on a layout made for flight", () => {
    it("offers the Space Center layout once, without switching to it", () => {
      const fixture = setup();
      const base = fixture.svc.save("Base", ITEMS, LAYOUT, ["SpaceCenter"]);
      fixture.svc.setCurrent(fixture.ascent.id);

      fixture.emitScene("SpaceCenter");

      expect(
        screen.getByText("Now at the Space Center: switch to Base?"),
      ).toBeTruthy();
      expect(fixture.svc.getCurrentId()).toBe(fixture.ascent.id);
      fixture.emitScene("SpaceCenter");
      expect(
        screen.getAllByRole("button", { name: /Switch to layout/ }),
      ).toHaveLength(1);
      expect(base.id).not.toBe(fixture.ascent.id);
    });

    it("does not switch automatically when the Space Center layout is not set to", () => {
      const fixture = setup();
      fixture.svc.save("Base", ITEMS, LAYOUT, ["SpaceCenter"]);
      fixture.svc.setCurrent(fixture.ascent.id);

      fixture.emitScene("SpaceCenter");

      expect(fixture.svc.getCurrentId()).toBe(fixture.ascent.id);
    });

    it("stays quiet for a manual layout bound to no scene", () => {
      const fixture = setup();
      fixture.svc.save("Base", ITEMS, LAYOUT, ["SpaceCenter"]);
      const mine = fixture.svc.save("Mine", ITEMS, LAYOUT);
      fixture.svc.setCurrent(mine.id);

      fixture.emitScene("SpaceCenter");

      expect(
        screen.queryByRole("button", { name: /Switch to layout/ }),
      ).toBeNull();
    });
  });
});
