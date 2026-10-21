import { InputDispatcher, SerialDeviceService } from "@ksp-gonogo/serial";
import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DashboardItem } from "../components/Dashboard";
import { MissionProfilesService } from "./MissionProfilesService";
import { ProfileDashboard } from "./ProfileDashboard";
import { ProfileSwitchBanner } from "./ProfileSwitchBanner";
import { profileInputOptions } from "./profileInputs";

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

const items = (id: string): DashboardItem[] => [
  { i: id, componentId: "fuel-status" },
];
const K = { deviceId: "keyboard", inputId: "KeyK" };

function press(code: string, target: EventTarget = window) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
    target.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
  });
}

describe("switching layouts with an input", () => {
  let serial: SerialDeviceService;
  let dispatcher: InputDispatcher;
  let svc: MissionProfilesService;
  let dashboard: ProfileDashboard;
  let shown: DashboardItem[];
  let launch: { id: string };
  let docking: { id: string };

  beforeEach(async () => {
    serial = new SerialDeviceService({
      screenKey: `test-${Math.random().toString(36).slice(2)}`,
      renderDebounceMs: 0,
    });
    await serial.autoReconnect();
    svc = new MissionProfilesService("main", memoryStorage());
    launch = svc.save("Launch", items("l"), []);
    docking = svc.save("Docking", items("d"), []);
    svc.setCurrent(launch.id);
    shown = items("l");
    dashboard = new ProfileDashboard(
      svc,
      (s) => {
        shown = s.items;
      },
      { items: items("l"), layout: [] },
    );
    dispatcher = new InputDispatcher({
      service: serial,
      getItems: () => [],
      ...profileInputOptions(svc, dashboard, serial),
    });
    svc.bindInput(docking.id, K);
  });

  afterEach(async () => {
    dispatcher.dispose();
    await serial.destroy();
  });

  it("switches to the layout when its input is pressed", () => {
    press("KeyK");

    expect(svc.getCurrentId()).toBe(docking.id);
    expect(shown.map((it) => it.i)).toEqual(["d"]);
  });

  it("does not switch when the key is typed into a text field", () => {
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();

    press("KeyK", field);

    expect(svc.getCurrentId()).toBe(launch.id);
    field.remove();
  });

  it("does not switch for a different key", () => {
    press("KeyJ");

    expect(svc.getCurrentId()).toBe(launch.id);
  });

  it("undoes the switch like any other", () => {
    press("KeyK");

    act(() => dashboard.undo());

    expect(svc.getCurrentId()).toBe(launch.id);
    expect(shown.map((it) => it.i)).toEqual(["l"]);
  });

  it("does nothing when the layout is already current", () => {
    press("KeyK");
    const undoable = dashboard.canUndo();
    press("KeyK");

    expect(svc.getCurrentId()).toBe(docking.id);
    expect(undoable).toBe(true);
    act(() => dashboard.undo());
    expect(svc.getCurrentId()).toBe(launch.id);
    expect(dashboard.canUndo()).toBe(false);
  });

  it("says which layout and which input it switched for", () => {
    render(<ProfileSwitchBanner dashboard={dashboard} />);
    expect(screen.queryByRole("status")).toBeNull();

    press("KeyK");

    expect(screen.getByRole("status").textContent).toBe(
      "Switched to Docking (key K)",
    );
  });

  it("shows nothing for a press of the current layout's input", () => {
    svc.setCurrent(docking.id);
    render(<ProfileSwitchBanner dashboard={dashboard} />);

    press("KeyK");

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows nothing when the layout is switched from the list", () => {
    render(<ProfileSwitchBanner dashboard={dashboard} />);

    act(() => {
      dashboard.switchTo(docking.id);
    });

    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("binding an input to a layout", () => {
  it("moves it from the layout that held it, and says which", () => {
    const svc = new MissionProfilesService("main", memoryStorage());
    const a = svc.save("Launch", items("l"), []);
    const b = svc.save("Docking", items("d"), []);
    svc.bindInput(a.id, K);

    const { movedFrom } = svc.bindInput(b.id, K);

    expect(movedFrom?.id).toBe(a.id);
    expect(svc.get(a.id)?.inputBinding).toBeUndefined();
    expect(svc.get(b.id)?.inputBinding).toEqual(K);
  });

  it("reports nothing moved for a free input, and clears with null", () => {
    const svc = new MissionProfilesService("main", memoryStorage());
    const a = svc.save("Launch", items("l"), []);

    expect(svc.bindInput(a.id, K).movedFrom).toBeNull();
    svc.bindInput(a.id, null);

    expect(svc.get(a.id)?.inputBinding).toBeUndefined();
  });

  it("is stored on the profile and survives a reload", () => {
    const storage = memoryStorage();
    const svc = new MissionProfilesService("main", storage);
    const a = svc.save("Launch", items("l"), []);
    svc.bindInput(a.id, K);

    expect(
      new MissionProfilesService("main", storage).get(a.id)?.inputBinding,
    ).toEqual(K);
  });

  it("does not keep a binding for another layout's key when the same key is set twice", () => {
    const svc = new MissionProfilesService("main", memoryStorage());
    const a = svc.save("Launch", items("l"), []);
    svc.bindInput(a.id, K);

    svc.bindInput(a.id, K);

    expect(svc.get(a.id)?.inputBinding).toEqual(K);
  });
});
