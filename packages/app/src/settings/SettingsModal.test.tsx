import type {
  ConfigField,
  DataSource,
  DataSourceStatus,
} from "@ksp-gonogo/core";
import {
  clearRegistry,
  registerDataSource,
  ScreenProvider,
} from "@ksp-gonogo/core";
import {
  createFakeWallClock,
  StubTransport,
  systemUplinkHealthChannel,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
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

/**
 * A fixture shaped like `packages/app/src/dataSources/sitrep.ts`'s
 * `sitrepStreamSource` singleton — same id/name production uses, so the
 * Data Sources tab's "just this one connection" behaviour is exercised
 * against the real production id, not an arbitrary test id.
 */
function makeSitrepStub(configureSpy = vi.fn()): DataSource {
  const listeners = new Set<(s: DataSourceStatus) => void>();
  return {
    id: "sitrep",
    name: "Sitrep Stream",
    status: "disconnected" as DataSourceStatus,
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    subscribe: () => () => {},
    execute: async () => {},
    configSchema: (): ConfigField[] => [
      { key: "host", label: "Host", type: "text", placeholder: "localhost" },
      { key: "port", label: "Port", type: "number", placeholder: "8090" },
    ],
    getConfig: () => ({ host: "localhost", port: 8090 }),
    configure: configureSpy,
    onStatusChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

/**
 * An arbitrary OTHER registered `DataSource` — used to prove the reworked
 * Data Sources tab does NOT fall back to an "Other Connections" list the
 * way the old `DataSourceStatusComponent` did (it rendered every registered
 * source).
 */
function makeOtherSourceStub(id: string, name: string): DataSource {
  return {
    id,
    name,
    status: "disconnected" as DataSourceStatus,
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    subscribe: () => () => {},
    execute: async () => {},
    configSchema: () => [],
    getConfig: () => ({}),
    configure: () => {},
    onStatusChange: () => () => {},
  };
}

/**
 * Mounts a real `TelemetryProvider` (a `TimelineStore` with
 * `systemUplinkHealthChannel` registered, over a `StubTransport`) around
 * `SettingsModal` — mirrors `telemetry-components.test.tsx`'s
 * `setupTelemetryStream` helper. `emit` pushes a raw `system.uplinks`
 * stream-data frame once the mounted `UplinkHealthList` has subscribed.
 */
function setupTelemetryStream() {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  store.registerDerivedChannel(systemUplinkHealthChannel);

  function Provider({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider client={client} store={store}>
        {children}
      </TelemetryProvider>
    );
  }

  return {
    emit: (payload: unknown) => transport.emit("system.uplinks", payload),
    Provider,
  };
}

function renderModalWithStream(
  stream: ReturnType<typeof setupTelemetryStream>,
) {
  const service = new SettingsService(memoryStorage());
  return render(
    <ScreenProvider value="main">
      <SettingsProvider service={service}>
        <stream.Provider>
          <SettingsModal />
        </stream.Provider>
      </SettingsProvider>
    </ScreenProvider>,
  );
}

async function openDataSourcesTab() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: /data sources/i }));
}

beforeEach(() => {
  clearRegistry();
});

afterEach(() => {
  cleanup();
  clearRegistry();
});

describe("SettingsModal Data Sources tab — single Gonogo/Sitrep connection", () => {
  it("shows the Sitrep Stream connection row when registered", async () => {
    registerDataSource(makeSitrepStub());
    renderModal("main");
    await openDataSourcesTab();
    expect(screen.getByText("Sitrep Stream")).toBeInTheDocument();
    expect(screen.getByText("disconnected")).toBeInTheDocument();
  });

  it("shows a placeholder when the sitrep source isn't registered", async () => {
    renderModal("main");
    await openDataSourcesTab();
    expect(
      screen.getByText("Telemetry stream not registered"),
    ).toBeInTheDocument();
  });

  it("labels the host row 'Game host' and never shows the Sitrep codename", async () => {
    renderModal("main");
    await openDataSourcesTab();
    expect(screen.getByText("Game host")).toBeInTheDocument();
    expect(screen.queryByText(/sitrep/i)).not.toBeInTheDocument();
  });

  it("does NOT render an unrelated registered data source — no 'Other Connections' list", async () => {
    registerDataSource(makeSitrepStub());
    registerDataSource(makeOtherSourceStub("kos", "kOS"));
    renderModal("main");
    await openDataSourcesTab();
    expect(screen.getByText("Sitrep Stream")).toBeInTheDocument();
    expect(screen.queryByText("kOS")).not.toBeInTheDocument();
  });

  it("opens the config form, pre-filled from getConfig(), and saves via configure()", async () => {
    const configureSpy = vi.fn();
    registerDataSource(makeSitrepStub(configureSpy));
    renderModal("main");
    await openDataSourcesTab();

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /configure sitrep stream/i }),
    );
    expect(screen.getByLabelText("Host")).toHaveValue("localhost");
    expect(screen.getByLabelText("Port")).toHaveValue(8090);

    const portInput = screen.getByLabelText("Port");
    await user.clear(portInput);
    await user.type(portInput, "9091");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(configureSpy).toHaveBeenCalledWith({
      host: "localhost",
      port: 9091,
    });
  });
});

describe("SettingsModal Data Sources tab — per-Uplink health (system.uplinkHealth)", () => {
  it("shows a waiting placeholder before any report has arrived", async () => {
    const stream = setupTelemetryStream();
    renderModalWithStream(stream);
    await openDataSourcesTab();
    expect(
      screen.getByText("Waiting for uplink health report…"),
    ).toBeInTheDocument();
  });

  it("renders each reported Uplink's id, version and health state", async () => {
    const stream = setupTelemetryStream();
    renderModalWithStream(stream);
    await openDataSourcesTab();

    stream.emit({
      uplinks: [
        {
          id: "kos",
          version: "1.0.0",
          available: true,
          reason: null,
          health: { state: 1, detail: "no active CPU selected" },
        },
        {
          id: "system",
          version: "1.0.0",
          available: true,
          reason: null,
          health: { state: 0, detail: null },
        },
      ],
    });

    await waitFor(() => expect(screen.getByText("kos")).toBeInTheDocument());
    expect(screen.getByText("degraded")).toBeInTheDocument();
    expect(screen.getByText("no active CPU selected")).toBeInTheDocument();
    expect(screen.getByText("system")).toBeInTheDocument();
    expect(screen.getByText("healthy")).toBeInTheDocument();
    expect(screen.getAllByText("v1.0.0")).toHaveLength(2);
  });

  it("shows the registration-failure reason as detail for an Unavailable uplink", async () => {
    const stream = setupTelemetryStream();
    renderModalWithStream(stream);
    await openDataSourcesTab();

    stream.emit({
      uplinks: [
        {
          id: "broken",
          version: "1.0.0",
          available: false,
          reason: "registration threw: boom",
          health: { state: 2, detail: "registration threw: boom" },
        },
      ],
    });

    await waitFor(() =>
      expect(screen.getByText("unavailable")).toBeInTheDocument(),
    );
    expect(screen.getByText("registration threw: boom")).toBeInTheDocument();
  });

  it("shows a placeholder when the reported uplink list is empty", async () => {
    const stream = setupTelemetryStream();
    renderModalWithStream(stream);
    await openDataSourcesTab();

    stream.emit({ uplinks: [] });

    await waitFor(() =>
      expect(screen.getByText("No uplinks registered")).toBeInTheDocument(),
    );
  });
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
