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
import { act, render } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import type { Layout } from "react-grid-layout";
import { describe, expect, it } from "vitest";
import type { DashboardItem } from "../components/Dashboard";
import { useDashboardState } from "../components/Dashboard/useDashboardState";
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

const ASCENT_ITEMS: DashboardItem[] = [{ i: "a", componentId: "fuel-status" }];
const ASCENT_LAYOUT: Layout = [
  { i: "a", x: 0, y: 0, w: 8, h: 14, moved: false, static: false },
];

const ARRANGED_ITEMS: DashboardItem[] = [
  { i: "m", componentId: "ground-track" },
  { i: "o", componentId: "orbit-view" },
];
const ARRANGED_LAYOUT: Layout = [
  { i: "m", x: 2, y: 0, w: 10, h: 8, moved: false, static: false },
  { i: "o", x: 12, y: 0, w: 12, h: 8, moved: false, static: false },
];

/** The dashboard and the scene prompt wired the way the main screen wires them. */
function Screen({
  svc,
  onState,
}: {
  svc: MissionProfilesService;
  onState: (state: { items: DashboardItem[]; layout: Layout }) => void;
}) {
  const dashboard = useDashboardState(
    "test:dashboard",
    { items: ARRANGED_ITEMS, layout: ARRANGED_LAYOUT },
    { onDiscard: (items, layout) => svc.saveDraft(items, layout) },
  );
  onState({ items: dashboard.items, layout: dashboard.layout });
  return (
    <SceneSwitchPrompt
      onLoad={(items, layout) => dashboard.replaceState(items, layout)}
    />
  );
}

function setup(autoSwitch: boolean) {
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
  svc.save("Ascent", ASCENT_ITEMS, ASCENT_LAYOUT, ["Flight"], autoSwitch);
  let latest = { items: ARRANGED_ITEMS, layout: ARRANGED_LAYOUT };

  function Wrap({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider client={client} store={store}>
        <MissionProfilesProvider service={svc}>
          {children}
        </MissionProfilesProvider>
      </TelemetryProvider>
    );
  }
  localStorage.removeItem("test:dashboard");
  render(
    <Wrap>
      <Screen svc={svc} onState={(s) => (latest = s)} />
    </Wrap>,
  );
  const emitScene = (scene: string) => {
    act(() => {
      transport.emit("spaceCenter.scene", { scene });
      store.beginFrame();
    });
  };
  return { svc, emitScene, state: () => latest };
}

describe("an automatic layout switch", () => {
  it("keeps the layout it replaces, so it can be loaded back", () => {
    const { svc, emitScene, state } = setup(true);

    emitScene("SpaceCenter");
    emitScene("Flight");

    expect(state().items).toEqual(ASCENT_ITEMS);
    const kept = svc.list().find((p) => p.name !== "Ascent");
    expect(kept?.items).toEqual(ARRANGED_ITEMS);
    expect(kept?.layout).toEqual(ARRANGED_LAYOUT);
  });

  it("keeps nothing when the layout it replaces is already saved", () => {
    const { svc, emitScene } = setup(true);
    svc.save("Mine", ARRANGED_ITEMS, ARRANGED_LAYOUT);

    emitScene("SpaceCenter");
    emitScene("Flight");

    expect(
      svc
        .list()
        .map((p) => p.name)
        .sort(),
    ).toEqual(["Ascent", "Mine"]);
  });
});
