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
import { afterEach, describe, expect, it } from "vitest";
import type { DashboardItem } from "../components/Dashboard";
import type { DashboardState } from "../components/Dashboard/useDashboardState";
import { MissionProfilesProvider } from "./MissionProfilesContext";
import { MissionProfilesService } from "./MissionProfilesService";
import type { ProfileDashboard } from "./ProfileDashboard";
import { SceneSwitchPrompt } from "./SceneSwitchPrompt";
import { useProfileDashboard } from "./useProfileDashboard";

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

const ARRANGED_LAYOUT: Layout = [
  { i: "m", x: 2, y: 0, w: 10, h: 8, moved: false, static: false },
  { i: "o", x: 12, y: 0, w: 12, h: 8, moved: false, static: false },
];

interface Live {
  dashboard: DashboardState;
  controller: ProfileDashboard;
}

/** The dashboard and the scene prompt wired the way the screens wire them. */
function Screen({
  svc,
  onLive,
}: {
  svc: MissionProfilesService;
  onLive: (live: Live) => void;
}) {
  const { dashboard, controller } = useProfileDashboard(svc, {
    items: [],
    layout: [],
  });
  onLive({ dashboard, controller });
  return <SceneSwitchPrompt dashboard={controller} />;
}

function setup(storage: Storage = memoryStorage()) {
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
  const svc = new MissionProfilesService("main", storage);
  let live: Live | undefined;

  function Wrap({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider client={client} store={store}>
        <MissionProfilesProvider service={svc}>
          {children}
        </MissionProfilesProvider>
      </TelemetryProvider>
    );
  }
  const view = render(
    <Wrap>
      <Screen svc={svc} onLive={(l) => (live = l)} />
    </Wrap>,
  );
  const current = () => {
    if (!live) throw new Error("screen not rendered");
    return live;
  };
  /** The operator arranges two widgets, as a drag from the library would. */
  const arrange = () => {
    act(() => {
      current().dashboard.addItem(
        { i: "m", componentId: "ground-track" },
        ARRANGED_LAYOUT[0],
      );
    });
    act(() => {
      current().dashboard.addItem(
        { i: "o", componentId: "orbit-view" },
        ARRANGED_LAYOUT[1],
      );
    });
    act(() => current().controller.flush());
  };
  const emitScene = (scene: string) => {
    act(() => {
      transport.emit("spaceCenter.scene", { scene });
      store.beginFrame();
    });
  };
  return { svc, emitScene, arrange, current, view };
}

const ids = (items: readonly DashboardItem[]) => items.map((it) => it.i);

describe("autosaving dashboards across scene changes", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("keeps an arrangement in its own profile when a scene switch loads another", () => {
    const { svc, emitScene, arrange, current } = setup();
    svc.save("Ascent", ASCENT_ITEMS, ASCENT_LAYOUT, ["Flight"], true);
    arrange();
    const arranged = svc.getCurrent();
    expect(arranged?.name).toBe("Unsaved layout");
    if (!arranged) throw new Error("no layout was created");
    svc.update(arranged.id, {
      sceneBindings: ["SpaceCenter"],
      autoSwitch: true,
    });

    emitScene("Editor");
    emitScene("Flight");
    expect(ids(current().dashboard.items)).toEqual(["a"]);
    expect(svc.getCurrent()?.name).toBe("Ascent");

    emitScene("SpaceCenter");

    expect(ids(current().dashboard.items)).toEqual(["m", "o"]);
    expect(svc.getCurrentId()).toBe(arranged.id);
    expect(svc.get(arranged.id)?.items.map((it) => it.i)).toEqual(["m", "o"]);
    expect(svc.get(arranged.id)?.layout).toEqual(
      expect.arrayContaining(
        ARRANGED_LAYOUT.map((l) =>
          expect.objectContaining({ i: l.i, x: l.x, w: l.w }),
        ),
      ),
    );
  });

  it("keeps editing the same unnamed layout across switches instead of forking it", () => {
    const { svc, emitScene, arrange, current } = setup();
    svc.save("Ascent", ASCENT_ITEMS, ASCENT_LAYOUT, ["Flight"], true);
    arrange();

    emitScene("Editor");
    emitScene("Flight");
    act(() => current().dashboard.removeItem("a"));
    act(() => current().controller.flush());

    expect(svc.list().filter((p) => p.draft)).toHaveLength(1);
    expect(svc.list().find((p) => p.name === "Ascent")?.items).toEqual([]);
  });

  it("leaves the current layout alone on a scene with no bound layout", () => {
    const { svc, emitScene, arrange, current } = setup();
    arrange();
    const before = svc.getCurrentId();

    emitScene("Editor");
    emitScene("TrackingStation");

    expect(svc.getCurrentId()).toBe(before);
    expect(ids(current().dashboard.items)).toEqual(["m", "o"]);
  });

  it("undoes a scene switch, putting the previous layout back", () => {
    const { svc, emitScene, arrange, current } = setup();
    svc.save("Ascent", ASCENT_ITEMS, ASCENT_LAYOUT, ["Flight"], true);
    arrange();
    const arrangedId = svc.getCurrentId();

    emitScene("Editor");
    emitScene("Flight");
    act(() => current().controller.undo());

    expect(svc.getCurrentId()).toBe(arrangedId);
    expect(ids(current().dashboard.items)).toEqual(["m", "o"]);
  });

  it("writes a change at once when the page is hidden, before the autosave delay", () => {
    const { svc, current } = setup();
    act(() => {
      current().dashboard.addItem(
        { i: "m", componentId: "ground-track" },
        ARRANGED_LAYOUT[0],
      );
    });
    expect(svc.list()).toHaveLength(0);

    act(() => {
      globalThis.dispatchEvent(new Event("pagehide"));
    });

    expect(svc.list()).toHaveLength(1);
    expect(svc.list()[0].items.map((it) => it.i)).toEqual(["m"]);
  });

  it("opens on the profile that was current when the page last closed", () => {
    const storage = memoryStorage();
    const first = setup(storage);
    first.arrange();
    first.view.unmount();

    const second = setup(storage);

    expect(ids(second.current().dashboard.items)).toEqual(["m", "o"]);
  });
});
