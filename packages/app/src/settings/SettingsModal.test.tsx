import type {
  ConfigField,
  DataSource,
  DataSourceStatus,
} from "@ksp-gonogo/core";
import {
  __clearSettingsTabsForTests,
  clearRegistry,
  registerDataSource,
  registerSettingsTab,
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
import { fireEvent, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import type { ReactNode } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { axe } from "../test/axe";
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

/**
 * `SettingsModal` now calls `useUplinkGap()` unconditionally (the "Uplink
 * Hub" tab's attention-dot indicator, added alongside `initialTabId` —
 * see the dedicated describe block below), which fires a `useQuery` for the
 * Hub registry. None of the fixtures in this file exercise that badge, so an
 * inert client (the query never actually runs — `enabled: false`) keeps
 * every other test's `render()` free of an async network round-trip that
 * could resolve after a synchronous test's assertions/unmount and trip an
 * act() warning (CLAUDE.md: "act() warnings are always our bug").
 */
function makeInertQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
}

function renderModal(screen_: "main" | "station" = "main") {
  const service = new SettingsService(memoryStorage());
  return render(
    <QueryClientProvider client={makeInertQueryClient()}>
      <ScreenProvider value={screen_}>
        <SettingsProvider service={service}>
          <SettingsModal />
        </SettingsProvider>
      </ScreenProvider>
    </QueryClientProvider>,
  );
}

/**
 * A fixture shaped like `packages/app/src/dataSources/sitrep.ts`'s
 * `sitrepStreamSource` singleton — same id/name production uses, so the
 * Data Sources tab's "just this one connection" behaviour is exercised
 * against the real production id, not an arbitrary test id.
 */
function makeSitrepStub(
  configureSpy = vi.fn(),
  status: DataSourceStatus = "disconnected",
): DataSource {
  const listeners = new Set<(s: DataSourceStatus) => void>();
  return {
    id: "sitrep",
    name: "Sitrep Stream",
    status,
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
    <QueryClientProvider client={makeInertQueryClient()}>
      <ScreenProvider value="main">
        <SettingsProvider service={service}>
          <stream.Provider>
            <SettingsModal />
          </stream.Provider>
        </SettingsProvider>
      </ScreenProvider>
    </QueryClientProvider>,
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
  clearRegistry();
  __clearSettingsTabsForTests();
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
    registerDataSource(makeSitrepStub(vi.fn(), "connected"));
    renderModalWithStream(stream);
    await openDataSourcesTab();
    expect(
      screen.getByText("Waiting for uplink health report..."),
    ).toBeInTheDocument();
  });

  it("renders each reported Uplink's id, version and health state", async () => {
    const stream = setupTelemetryStream();
    registerDataSource(makeSitrepStub(vi.fn(), "connected"));
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

    // "system" is healthy with no detail, so it collapses into the N/M
    // healthy chip by default (Task 6) — expand it to assert its fields too.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /show/i }));

    expect(screen.getByText("system")).toBeInTheDocument();
    expect(screen.getByText("healthy")).toBeInTheDocument();
    expect(screen.getAllByText("v1.0.0")).toHaveLength(2);
  });

  it("shows the registration-failure reason as detail for an Unavailable uplink", async () => {
    const stream = setupTelemetryStream();
    registerDataSource(makeSitrepStub(vi.fn(), "connected"));
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
    registerDataSource(makeSitrepStub(vi.fn(), "connected"));
    renderModalWithStream(stream);
    await openDataSourcesTab();

    stream.emit({ uplinks: [] });

    await waitFor(() =>
      expect(screen.getByText("No uplinks registered")).toBeInTheDocument(),
    );
  });

  it("shows 'No telemetry host' instead of the generic waiting placeholder when the sitrep source is disconnected", async () => {
    const stream = setupTelemetryStream();
    registerDataSource(makeSitrepStub(vi.fn(), "disconnected"));
    renderModalWithStream(stream);
    await openDataSourcesTab();
    expect(screen.getByText("No telemetry host")).toBeInTheDocument();
    expect(
      screen.queryByText("Waiting for uplink health report..."),
    ).not.toBeInTheDocument();
  });
});

describe("SettingsModal Data Sources tab — healthy-uplinks collapse chip", () => {
  it("folds plain healthy/no-detail uplinks into an N/M healthy chip, collapsed by default", async () => {
    const stream = setupTelemetryStream();
    registerDataSource(makeSitrepStub(vi.fn(), "connected"));
    renderModalWithStream(stream);
    await openDataSourcesTab();

    stream.emit({
      uplinks: [
        {
          id: "vessel",
          version: "1.0.0",
          available: true,
          reason: null,
          health: { state: 0, detail: null },
        },
        {
          id: "career",
          version: "1.0.0",
          available: true,
          reason: null,
          health: { state: 0, detail: null },
        },
        {
          id: "kos",
          version: "1.0.0",
          available: true,
          reason: null,
          health: { state: 1, detail: "no active CPU selected" },
        },
      ],
    });

    await waitFor(() =>
      expect(screen.getByText("2/3 healthy")).toBeInTheDocument(),
    );
    expect(screen.queryByText("vessel")).not.toBeInTheDocument();
    expect(screen.queryByText("career")).not.toBeInTheDocument();
    // The non-healthy uplink stays individually visible, uncollapsed.
    expect(screen.getByText("kos")).toBeInTheDocument();
    expect(screen.getByText("no active CPU selected")).toBeInTheDocument();
  });

  it("expands the healthy list when the chip's toggle is clicked", async () => {
    const stream = setupTelemetryStream();
    registerDataSource(makeSitrepStub(vi.fn(), "connected"));
    renderModalWithStream(stream);
    await openDataSourcesTab();

    stream.emit({
      uplinks: [
        {
          id: "vessel",
          version: "1.0.0",
          available: true,
          reason: null,
          health: { state: 0, detail: null },
        },
        {
          id: "career",
          version: "1.0.0",
          available: true,
          reason: null,
          health: { state: 0, detail: null },
        },
      ],
    });
    await waitFor(() =>
      expect(screen.getByText("2/2 healthy")).toBeInTheDocument(),
    );
    expect(screen.queryByText("vessel")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /show/i }));

    expect(screen.getByText("vessel")).toBeInTheDocument();
    expect(screen.getByText("career")).toBeInTheDocument();
  });

  it("does NOT collapse a healthy uplink that carries a self-reported detail string", async () => {
    const stream = setupTelemetryStream();
    registerDataSource(makeSitrepStub(vi.fn(), "connected"));
    renderModalWithStream(stream);
    await openDataSourcesTab();

    stream.emit({
      uplinks: [
        {
          id: "comms",
          version: "1.0.0",
          available: true,
          reason: null,
          health: { state: 0, detail: "backend: CommNet elected" },
        },
      ],
    });

    await waitFor(() => expect(screen.getByText("comms")).toBeInTheDocument());
    expect(screen.getByText("backend: CommNet elected")).toBeInTheDocument();
    // No collapse chip renders — distinct from the row's own inline health
    // state label (also literally "healthy"), which is why this checks the
    // chip's specific "N/M healthy" wording rather than a bare /healthy$/.
    expect(screen.queryByText(/\d+\/\d+ healthy/)).not.toBeInTheDocument();
  });

  it("has no axe violations with a mix of collapsed-healthy and expanded non-healthy uplinks", async () => {
    const stream = setupTelemetryStream();
    registerDataSource(makeSitrepStub(vi.fn(), "connected"));
    const { container } = renderModalWithStream(stream);
    await openDataSourcesTab();

    stream.emit({
      uplinks: [
        {
          id: "vessel",
          version: "1.0.0",
          available: true,
          reason: null,
          health: { state: 0, detail: null },
        },
        {
          id: "kos",
          version: "1.0.0",
          available: true,
          reason: null,
          health: { state: 1, detail: "no active CPU selected" },
        },
      ],
    });
    await waitFor(() =>
      expect(screen.getByText("1/2 healthy")).toBeInTheDocument(),
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("SettingsModal — Uplink Hub tab (initialTabId + attention indicator)", () => {
  const registryServer = setupServer();

  beforeAll(() => registryServer.listen({ onUnhandledRequest: "bypass" }));
  afterEach(() => registryServer.resetHandlers());
  afterAll(() => registryServer.close());

  function renderWithRealQuery(node: ReactNode) {
    const service = new SettingsService(memoryStorage());
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <ScreenProvider value="main">
          <SettingsProvider service={service}>{node}</SettingsProvider>
        </ScreenProvider>
      </QueryClientProvider>,
    );
  }

  it("opens directly on the Uplink Hub tab when initialTabId is set (first-run auto-open host)", () => {
    registryServer.use(
      http.get("*/uplinks/registry.local.json", () =>
        HttpResponse.json({ uplinks: [] }),
      ),
    );
    renderWithRealQuery(<SettingsModal initialTabId="uplink-hub" />);
    expect(
      screen.getByRole("tab", { name: "Uplink Hub", selected: true }),
    ).toBeInTheDocument();
  });

  it("shows an attention dot on the Uplink Hub tab once the cross-reference finds a load-from-hub gap", async () => {
    registryServer.use(
      http.get("*/uplinks/registry.local.json", () =>
        HttpResponse.json({
          uplinks: [
            {
              id: "widget-hub",
              name: "Hub Widget",
              author: "tester",
              repo: "example/repo",
              versions: [
                {
                  version: "1.0.0",
                  minAppVersion: "1.0.0",
                  apiVersion: "1.0.0",
                  uiKitVersion: "1.0.0",
                  contractMajor: 1,
                  bundleUrl: "/uplinks/widget-hub.client.js",
                  integrity: "sha256-fake",
                },
              ],
            },
          ],
        }),
      ),
    );
    const stream = setupTelemetryStream();
    renderWithRealQuery(
      <stream.Provider>
        <SettingsModal />
      </stream.Provider>,
    );

    stream.emit({
      uplinks: [
        {
          id: "widget-hub",
          version: "1.0.0",
          available: true,
          reason: null,
          health: { state: 0, detail: null },
        },
      ],
    });

    await waitFor(() => {
      const tab = screen.getByRole("tab", { name: "Uplink Hub" });
      // The dot is deliberately `aria-hidden` (decorative) — a plain <span>
      // structural check is the only way to see it, same escape hatch the
      // Tabs component itself offers no accessible query for.
      expect(tab.querySelector("span")).not.toBeNull();
    });
  });

  it("does NOT show an attention dot when nothing is installed", async () => {
    registryServer.use(
      http.get("*/uplinks/registry.local.json", () =>
        HttpResponse.json({ uplinks: [] }),
      ),
    );
    const stream = setupTelemetryStream();
    registerDataSource(makeSitrepStub(vi.fn(), "connected"));
    renderWithRealQuery(
      <stream.Provider>
        <SettingsModal />
      </stream.Provider>,
    );

    stream.emit({ uplinks: [] });

    // Confirm the roster + registry have both settled by observing the Data
    // Sources tab's own placeholder — tab buttons stay queryable regardless
    // of which panel is active, so this is a reliable settlement signal
    // before asserting the Uplink Hub tab's dot is absent.
    await openDataSourcesTab();
    await waitFor(() =>
      expect(screen.getByText("No uplinks registered")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("tab", { name: "Uplink Hub" }).querySelector("span"),
    ).toBeNull();
  });
});

describe("SettingsModal registered-tab gating", () => {
  it("shows a registered main-only tab on the main screen", () => {
    registerSettingsTab({
      id: "fixture-tab",
      label: "Fixture",
      screens: ["main"],
      component: () => <div>fixture-tab-content</div>,
    });
    renderModal("main");
    expect(screen.getByRole("tab", { name: /fixture/i })).toBeInTheDocument();
  });

  it("hides a main-only registered tab on the station screen", () => {
    registerSettingsTab({
      id: "fixture-tab",
      label: "Fixture",
      screens: ["main"],
      component: () => <div>fixture-tab-content</div>,
    });
    renderModal("station");
    expect(
      screen.queryByRole("tab", { name: /fixture/i }),
    ).not.toBeInTheDocument();
  });

  it("shows no registered tab when none is registered", () => {
    renderModal("main");
    expect(
      screen.queryByRole("tab", { name: /fixture/i }),
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
