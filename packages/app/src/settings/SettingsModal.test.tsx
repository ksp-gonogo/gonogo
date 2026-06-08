import {
  clearRegistry,
  registerDataSource,
  ScreenProvider,
} from "@gonogo/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsProvider } from "./SettingsContext";
import { SettingsModal } from "./SettingsModal";
import { SettingsService } from "./SettingsService";

/*
 * Mocks for sidebar dependencies that SettingsModal pulls in but the
 * tab-gating tests don't exercise.
 */

vi.mock("@gonogo/serial", () => ({
  SerialDevicesMenu: () => null,
  useSerialAggregateStatus: () => "ok",
}));

vi.mock("@gonogo/components", () => ({
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

vi.mock("@gonogo/kerbcam", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@gonogo/kerbcam")>();
  return {
    ...actual,
    KerbcamSettings: () => <div>kerbcam-settings-stub</div>,
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
 * Minimal stub that satisfies KerbcamDataSource's interface for the tab
 * gating check (only id is required by getDataSource / registerDataSource).
 */
function makeKerbcamStub() {
  return {
    id: "kerbcam",
    name: "Kerbcam",
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
        import("@gonogo/kerbcam").KerbcamDataSource["getClient"]
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

describe("SettingsModal Kerbcam tab gating", () => {
  it("shows the Kerbcam tab on the main screen when the kerbcam source is registered", () => {
    registerDataSource(
      makeKerbcamStub() as unknown as Parameters<typeof registerDataSource>[0],
    );
    renderModal("main");
    expect(screen.getByRole("tab", { name: /kerbcam/i })).toBeInTheDocument();
  });

  it("hides the Kerbcam tab when there is no kerbcam source", () => {
    renderModal("main");
    expect(
      screen.queryByRole("tab", { name: /kerbcam/i }),
    ).not.toBeInTheDocument();
  });

  it("hides the Kerbcam tab on the station screen even when the source is registered", () => {
    registerDataSource(
      makeKerbcamStub() as unknown as Parameters<typeof registerDataSource>[0],
    );
    renderModal("station");
    expect(
      screen.queryByRole("tab", { name: /kerbcam/i }),
    ).not.toBeInTheDocument();
  });
});
