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
import { act, render, screen } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import type { Layout } from "react-grid-layout";
import { describe, expect, it, vi } from "vitest";
import type { DashboardItem } from "../components/Dashboard";
import { MissionProfilesProvider } from "./MissionProfilesContext";
import { MissionProfilesService } from "./MissionProfilesService";
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
  svc.save("Ascent", ITEMS, LAYOUT, ["Flight"]);
  const onLoad = vi.fn();

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
      <SceneSwitchPrompt onLoad={onLoad} />
    </Wrap>,
  );
  return {
    onLoad,
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
});
