import {
  clearRegistry,
  registerDataSource,
  ScreenProvider,
} from "@ksp-gonogo/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSetting } from "./registry";
import { SettingsProvider } from "./SettingsContext";
import { SettingsModal } from "./SettingsModal";
import { SettingsService } from "./SettingsService";

/*
 * Mocks for sidebar dependencies that SettingsModal pulls in but the
 * tab-gating tests don't exercise.
 */

vi.mock("@ksp-gonogo/serial", () => ({
  SerialDevicesMenu: () => null,
  useSerialAggregateStatus: () => "ok",
}));

vi.mock("@ksp-gonogo/components", () => ({
  DataSourceStatusComponent: () => null,
}));

vi.mock("../analytics/AnalyticsConsentService", () => ({
  analyticsConsentService: {
    isEnabled: () => false,
    subscribe: () => () => {},
    set: () => {},
  },
}));

vi.mock("../backup/BackupManager", () => ({
  BackupManager: () => null,
}));

vi.mock("../logs/LogsManager", () => ({
  LogsManager: () => null,
}));

vi.mock("@ksp-gonogo/kerbcast-feed", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@ksp-gonogo/kerbcast-feed")>();
  return {
    ...actual,
    KerbcastSettings: () => <div>kerbcast-settings-stub</div>,
  };
});

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    length: m.size,
    clear: () => m.clear(),
    key: () => null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  } as Storage;
}

function renderModal(screen_: "main" | "station" = "main") {
  const service = new SettingsService(memoryStorage());
  return render(
    <ScreenProvider value={screen_}>
      <SettingsProvider service={service}>
        <SettingsModal />
      </SettingsProvider>
    </ScreenProvider>,
  );
}

/*
 * Minimal stub that satisfies KerbcastDataSource's interface for the tab
 * gating check (only id is required by getDataSource / registerDataSource).
 */
function makeKerbcastStub() {
  return {
    id: "kerbcast",
    name: "Kerbcast",
    status: "disconnected",
    affectedBySignalLoss: false,
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    subscribe: () => () => {},
    execute: async () => {},
    onStatusChange: () => () => {},
    configSchema: () => [],
    getConfig: () => ({ host: "h", port: 1 }),
    configure: () => {},
    getThrottleMainScreen: () => false,
    onThrottleChange: () => () => {},
    setThrottleMainScreen: async () => {},
    getClient: () =>
      ({}) as unknown as ReturnType<
        import("@ksp-gonogo/kerbcast-feed").KerbcastDataSource["getClient"]
      >,
  };
}

beforeEach(() => {
  clearRegistry();
});

afterEach(() => {
  cleanup();
  clearRegistry();
});

describe("SettingsModal Kerbcast tab gating", () => {
  it("shows the Kerbcast tab on the main screen when the kerbcast source is registered", () => {
    registerDataSource(
      makeKerbcastStub() as unknown as Parameters<typeof registerDataSource>[0],
    );
    renderModal("main");
    expect(screen.getByRole("tab", { name: /kerbcast/i })).toBeInTheDocument();
  });

  it("hides the Kerbcast tab when there is no kerbcast source", () => {
    renderModal("main");
    expect(
      screen.queryByRole("tab", { name: /kerbcast/i }),
    ).not.toBeInTheDocument();
  });

  it("hides the Kerbcast tab on the station screen even when the source is registered", () => {
    registerDataSource(
      makeKerbcastStub() as unknown as Parameters<typeof registerDataSource>[0],
    );
    renderModal("station");
    expect(
      screen.queryByRole("tab", { name: /kerbcast/i }),
    ).not.toBeInTheDocument();
  });
});

describe("SettingsModal — dependsOn (nested/inert sub-toggle)", () => {
  const PARENT_ID = "test.parentToggle";
  const CHILD_ID = "test.childToggle";

  beforeEach(() => {
    registerSetting({
      id: PARENT_ID,
      type: "boolean",
      label: "Parent toggle",
      category: "Test",
      defaultValue: true,
      screens: ["main"],
    });
    registerSetting({
      id: CHILD_ID,
      type: "boolean",
      label: "Child toggle",
      category: "Test",
      defaultValue: false,
      screens: ["main"],
      dependsOn: PARENT_ID,
    });
  });

  it("child switch is enabled while the parent is on, disabled the instant it's toggled off", () => {
    renderModal("main");
    const parentSwitch = screen.getByRole("checkbox", {
      name: /parent toggle/i,
    });
    const childSwitch = screen.getByRole("checkbox", {
      name: /child toggle/i,
    });

    expect(parentSwitch).not.toBeDisabled();
    expect(childSwitch).not.toBeDisabled();

    fireEvent.click(parentSwitch);
    expect(childSwitch).toBeDisabled();
  });

  it("child switch starts disabled when the parent's default is off", () => {
    registerSetting({
      id: PARENT_ID,
      type: "boolean",
      label: "Parent toggle",
      category: "Test",
      defaultValue: false,
      screens: ["main"],
    });
    renderModal("main");
    expect(
      screen.getByRole("checkbox", { name: /child toggle/i }),
    ).toBeDisabled();
  });
});
