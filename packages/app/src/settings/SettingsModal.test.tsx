import type {
  ConfigField,
  DataSource,
  DataSourceStatus,
} from "@ksp-gonogo/core";
import {
  __clearSettingsTabsForTests,
  clearRegistry,
  clearUplinkHandles,
  registerDataSource,
  registerSettingsTab,
  ScreenProvider,
} from "@ksp-gonogo/core";
import {
  systemUplinkHealthChannel,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  createFakeWallClock,
  StubTransport,
} from "@ksp-gonogo/sitrep-sdk/testing";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveUplinkIdentity } from "../uplinks/identity";
import {
  __resetUplinkOutcomes,
  setUplinkOutcome,
} from "../uplinks/loaderState";
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
 * Rendered trees, tracked so afterEach can unmount them BEFORE it clears the
 * stores they read through useSyncExternalStore: a clear that notifies a
 * still-mounted tree is a state update outside act() (CLAUDE.md -> Testing
 * Philosophy), and RTL auto-cleanup runs after this file's afterEach.
 */
const renderedTrees: Array<() => void> = [];

function renderModal(screen_: "main" | "station" = "main") {
  const service = new SettingsService(memoryStorage());
  const view = render(
    <ScreenProvider value={screen_}>
      <SettingsProvider service={service}>
        <SettingsModal />
      </SettingsProvider>
    </ScreenProvider>,
  );
  renderedTrees.push(view.unmount);
  return view;
}

/**
 * A fixture shaped like `packages/app/src/dataSources/sitrep.ts`'s
 * `sitrepStreamSource` singleton: same id/name production uses, so the
 * Connection tab's "just this one connection" behaviour is exercised
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
 * An arbitrary OTHER registered `DataSource`: proves the Connection tab
 * does NOT fall back to an "Other Connections" list of every registered
 * source.
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
    configSchema: () => [],
    getConfig: () => ({}),
    configure: () => {},
    onStatusChange: () => () => {},
  };
}

/**
 * Mounts a real `TelemetryProvider` (a `TimelineStore` with
 * `systemUplinkHealthChannel` registered, over a `StubTransport`) around
 * `SettingsModal`: mirrors `telemetry-components.test.tsx`'s
 * `setupTelemetryStream` helper. `emit` pushes a raw `system.uplinks`
 * stream-data frame once something mounted has subscribed to it.
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
    emitTopic: (topic: string, payload: unknown) =>
      transport.emit(topic, payload),
    Provider,
  };
}

function renderModalWithStream(
  stream: ReturnType<typeof setupTelemetryStream>,
) {
  const service = new SettingsService(memoryStorage());
  const view = render(
    <ScreenProvider value="main">
      <SettingsProvider service={service}>
        <stream.Provider>
          <SettingsModal />
        </stream.Provider>
      </SettingsProvider>
    </ScreenProvider>,
  );
  renderedTrees.push(view.unmount);
  return view;
}

async function openConnectionTab() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: /connection/i }));
}

async function openUplinkPage(name: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("tab", { name: "Uplinks" }));
  await user.click(await screen.findByRole("tab", { name }));
}

/** Gives an Uplink a page before the mod reports anything about it. */
function registerUplinkPanel(uplink: string) {
  registerSettingsTab({
    id: `${uplink}-panel`,
    label: "Panel",
    uplink,
    component: () => null,
  });
}

/** An Uplink as `system.uplinks` carries it. */
function uplinkEntry(id: string, health: Record<string, unknown>) {
  return { id, version: "1.0.0", available: true, reason: null, health };
}

beforeEach(() => {
  clearRegistry();
});

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearRegistry();
  clearUplinkHandles();
  // The loaded-client list reads this store, so it is cleared after the unmount loop.
  __resetUplinkOutcomes();
  __clearSettingsTabsForTests();
});

describe("SettingsModal Connection tab: the one game connection", () => {
  it("shows the Sitrep Stream connection row when registered", async () => {
    registerDataSource(makeSitrepStub());
    renderModal("main");
    await openConnectionTab();
    expect(screen.getByText("Sitrep Stream")).toBeInTheDocument();
    expect(screen.getByText("disconnected")).toBeInTheDocument();
  });

  it("shows a placeholder when the sitrep source isn't registered", async () => {
    renderModal("main");
    await openConnectionTab();
    expect(
      screen.getByText("Telemetry stream not registered"),
    ).toBeInTheDocument();
  });

  it("labels the host row 'Game host' and never shows the Sitrep codename", async () => {
    renderModal("main");
    await openConnectionTab();
    expect(screen.getByText("Game host")).toBeInTheDocument();
    expect(screen.queryByText(/sitrep/i)).not.toBeInTheDocument();
  });

  it("does NOT render an unrelated registered data source, no 'Other Connections' list", async () => {
    registerDataSource(makeSitrepStub());
    registerDataSource(makeOtherSourceStub("kos", "kOS"));
    renderModal("main");
    await openConnectionTab();
    expect(screen.getByText("Sitrep Stream")).toBeInTheDocument();
    expect(screen.queryByText("kOS")).not.toBeInTheDocument();
  });

  it("opens the config form, pre-filled from getConfig(), and saves via configure()", async () => {
    const configureSpy = vi.fn();
    registerDataSource(makeSitrepStub(configureSpy));
    renderModal("main");
    await openConnectionTab();

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

describe("SettingsModal: an Uplink's page reports its health", () => {
  it("waits for the mod's roster before saying anything about health", async () => {
    const stream = setupTelemetryStream();
    registerDataSource(makeSitrepStub(vi.fn(), "connected"));
    registerUplinkPanel("kos");
    renderModalWithStream(stream);
    await openUplinkPage("kos");
    expect(
      screen.getByText("Waiting for KSP to report kos's health."),
    ).toBeInTheDocument();
  });

  it("shows the mod half's version, health state and detail on its own page", async () => {
    const stream = setupTelemetryStream();
    registerDataSource(makeSitrepStub(vi.fn(), "connected"));
    renderModalWithStream(stream);
    act(() =>
      stream.emit({
        uplinks: [
          uplinkEntry("kos", { state: 1, detail: "no active CPU selected" }),
          uplinkEntry("system", { state: 0, detail: null }),
        ],
      }),
    );
    await openUplinkPage("kos");

    expect(screen.getByRole("heading", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByText("Mod")).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("degraded")).toBeInTheDocument();
    expect(screen.getByText("no active CPU selected")).toBeInTheDocument();
    expect(screen.queryByText("healthy")).toBeNull();
  });

  it("shows the registration-failure reason as detail for an unavailable Uplink", async () => {
    const stream = setupTelemetryStream();
    registerDataSource(makeSitrepStub(vi.fn(), "connected"));
    renderModalWithStream(stream);
    act(() =>
      stream.emit({
        uplinks: [
          {
            ...uplinkEntry("broken", { state: 2, detail: null }),
            available: false,
            reason: "registration threw: boom",
          },
        ],
      }),
    );
    await openUplinkPage("broken");

    expect(screen.getByText("unavailable")).toBeInTheDocument();
    expect(screen.getByText("registration threw: boom")).toBeInTheDocument();
  });

  it("lists an Uplink's own diagnostic facts as labelled rows", async () => {
    const stream = setupTelemetryStream();
    registerDataSource(makeSitrepStub(vi.fn(), "connected"));
    const { container } = renderModalWithStream(stream);
    act(() =>
      stream.emit({
        uplinks: [
          uplinkEntry("demo-native", {
            state: 1,
            detail: "This build has not been vetted here.",
            facts: [
              { label: "descriptor", value: "b2569d21" },
              { label: "release", value: null },
            ],
          }),
        ],
      }),
    );
    await openUplinkPage("demo-native");

    const label = await screen.findByText("descriptor");
    expect(label.closest("dt")).not.toBeNull();
    expect(screen.getByText("b2569d21").closest("dl")).toBe(
      label.closest("dl"),
    );
    // A fact the Uplink could not establish reads as the null placeholder rather than as a blank cell an operator scans past.
    const placeholders = [...container.querySelectorAll("dd")].filter(
      (dd) => dd.textContent === NULL_DISPLAY,
    );
    expect(placeholders).toHaveLength(1);
    await expectNoA11yViolations(container);
  });

  it("says so when the mod does not list an Uplink whose client has a page", async () => {
    const stream = setupTelemetryStream();
    registerDataSource(makeSitrepStub(vi.fn(), "connected"));
    registerUplinkPanel("ghost");
    renderModalWithStream(stream);
    act(() =>
      stream.emit({
        uplinks: [uplinkEntry("kos", { state: 0, detail: null })],
      }),
    );
    await openUplinkPage("ghost");

    expect(screen.getByText("KSP does not list ghost.")).toBeInTheDocument();
  });

  it("says there is no telemetry host rather than waiting, when the stream is down", async () => {
    const stream = setupTelemetryStream();
    registerDataSource(makeSitrepStub(vi.fn(), "disconnected"));
    registerUplinkPanel("kos");
    renderModalWithStream(stream);
    await openUplinkPage("kos");

    expect(screen.getByText("No telemetry host.")).toBeInTheDocument();
  });

  it("opens the Uplinks tab on the first Uplink that is not healthy, and marks it", async () => {
    const stream = setupTelemetryStream();
    registerDataSource(makeSitrepStub(vi.fn(), "connected"));
    renderModalWithStream(stream);
    act(() =>
      stream.emit({
        uplinks: [
          uplinkEntry("system", { state: 0, detail: null }),
          uplinkEntry("kos", { state: 1, detail: "no active CPU selected" }),
        ],
      }),
    );
    const user = userEvent.setup();
    const uplinksTab = await screen.findByRole("tab", { name: /^Uplinks/ });
    await waitFor(() =>
      expect(uplinksTab).toHaveAccessibleDescription(/attention/i),
    );
    await user.click(uplinksTab);

    expect(
      screen.getByRole("tab", { name: /^kos/, selected: true }),
    ).toBeInTheDocument();
  });

  it("keeps health off the Connection tab", async () => {
    const stream = setupTelemetryStream();
    registerDataSource(makeSitrepStub(vi.fn(), "connected"));
    renderModalWithStream(stream);
    act(() =>
      stream.emit({
        uplinks: [uplinkEntry("kos", { state: 1, detail: "no active CPU" })],
      }),
    );
    await openConnectionTab();

    expect(screen.getByText("Sitrep Stream")).toBeInTheDocument();
    expect(screen.queryByText("no active CPU")).toBeNull();
    expect(
      screen.getByRole("tab", { name: /^Connection/ }),
    ).not.toHaveAccessibleDescription(/attention/i);
  });
});

describe("SettingsModal: initialTabId", () => {
  it("opens directly on the named tab", () => {
    const service = new SettingsService(memoryStorage());
    const view = render(
      <ScreenProvider value="main">
        <SettingsProvider service={service}>
          <SettingsModal initialTabId="connection" />
        </SettingsProvider>
      </ScreenProvider>,
    );
    renderedTrees.push(view.unmount);
    expect(
      screen.getByRole("tab", { name: /^Connection/, selected: true }),
    ).toBeInTheDocument();
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

describe("SettingsModal: dependsOn (nested/inert sub-toggle)", () => {
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

/*
 * Read-only, typed and grouped rows: a mod whose settings are provenance
 * (which plotting frame, what tolerance, which build) needs somewhere to put
 * them other than a writable boolean `Switch` in a flat list, or a bespoke
 * tab (a status widget with a different frame around it).
 */

interface FramePrefs {
  frameName: string;
  tolerance: number;
  maxSteps: number;
  declutter: boolean;
}

/* The example Topic these rows read. A stream-backed row names a Topic the
   contract carries, so a row pointing at one nothing publishes does not
   compile rather than rendering nothing forever. */
declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    "example.settings": FramePrefs;
  }
}

const FRAME_PREFS: FramePrefs = {
  frameName: "Kerbin-centred inertial",
  tolerance: 1,
  maxSteps: 1000,
  declutter: true,
};

function registerStreamBackedRows() {
  registerSetting({
    id: "example.frame",
    backing: "stream-backed",
    type: "text",
    topic: "example.settings",
    select: (p) => p.frameName,
    category: "Example",
    group: "Plotting frame",
    label: "Selected frame",
    screens: ["main"],
  });
  registerSetting({
    id: "example.tolerance",
    backing: "stream-backed",
    type: "number",
    topic: "example.settings",
    select: (p) => value("m", p.tolerance),
    category: "Example",
    group: "Prediction",
    label: "Prediction tolerance",
    screens: ["main"],
  });
  registerSetting({
    id: "example.maxSteps",
    backing: "stream-backed",
    type: "number",
    topic: "example.settings",
    select: (p) => p.maxSteps,
    category: "Example",
    group: "Prediction",
    label: "Max steps",
    screens: ["main"],
  });
}

describe("SettingsModal: stream-backed read-only rows", () => {
  it("renders the value as a term/definition pair, never as a control", async () => {
    registerStreamBackedRows();
    const stream = setupTelemetryStream();
    renderModalWithStream(stream);

    act(() => stream.emitTopic("example.settings", FRAME_PREFS));

    const frame = await screen.findByText("Kerbin-centred inertial");
    expect(frame.closest("dd")).not.toBeNull();
    // The row is data. A disabled control would be skipped by some screen
    // readers and would promise a write that does not exist.
    expect(
      screen.queryByRole("checkbox", { name: /selected frame/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("textbox", { name: /selected frame/i }),
    ).toBeNull();
    await act(async () => {});
  });

  it("announces the label with the value it belongs to", async () => {
    registerStreamBackedRows();
    const stream = setupTelemetryStream();
    renderModalWithStream(stream);

    act(() => stream.emitTopic("example.settings", FRAME_PREFS));

    // The value is what arrives late; the label renders from the definition immediately, so awaiting the label would prove nothing.
    const shown = await screen.findByText("Kerbin-centred inertial");
    const label = screen.getByText("Selected frame");
    expect(label.closest("dt")).not.toBeNull();
    expect(label.closest("dl")).toBe(shown.closest("dl"));
    await act(async () => {});
  });

  it("renders a quantity through Unit, so the unit is spoken", async () => {
    registerStreamBackedRows();
    const stream = setupTelemetryStream();
    renderModalWithStream(stream);

    act(() => stream.emitTopic("example.settings", FRAME_PREFS));

    // The symbol is drawn and hidden from the accessibility tree; the word is
    // what a screen reader gets. `1` on its own would be a lie about a length.
    expect(await screen.findByText("m")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText(/metres/)).toBeInTheDocument();
    await act(async () => {});
  });

  it("shows the null placeholder while the topic is silent", async () => {
    registerStreamBackedRows();
    const stream = setupTelemetryStream();
    const { container } = renderModalWithStream(stream);

    // Nothing emitted: three rows, three placeholders, and no invented zeroes.
    const placeholders = [...container.querySelectorAll("dd")].filter(
      (dd) => dd.textContent === NULL_DISPLAY,
    );
    expect(placeholders).toHaveLength(3);
    await act(async () => {});
  });

  it("passes the a11y smoke assertion with read-only and writable rows mixed", async () => {
    registerStreamBackedRows();
    registerSetting({
      id: "example.pref",
      type: "boolean",
      label: "A writable preference",
      category: "Example",
      defaultValue: true,
      screens: ["main"],
    });
    const stream = setupTelemetryStream();
    const { container } = renderModalWithStream(stream);
    act(() => stream.emitTopic("example.settings", FRAME_PREFS));
    await screen.findByText("Kerbin-centred inertial");

    await expectNoA11yViolations(container);
    await act(async () => {});
  });
});

describe("SettingsModal: grouping inside a category", () => {
  it("puts ungrouped rows above the named groups", async () => {
    registerSetting({
      id: "example.ungrouped",
      type: "boolean",
      label: "An ungrouped row",
      category: "Example",
      defaultValue: true,
      screens: ["main"],
    });
    registerStreamBackedRows();
    const stream = setupTelemetryStream();
    const { container } = renderModalWithStream(stream);
    act(() => stream.emitTopic("example.settings", FRAME_PREFS));
    await screen.findByText("Kerbin-centred inertial");

    const order = [...container.querySelectorAll("h3, h4, dt, span")]
      .map((el) => el.textContent)
      .filter((t): t is string => t !== null);
    const category = order.indexOf("Example");
    const ungrouped = order.indexOf("An ungrouped row");
    const firstGroup = order.indexOf("Plotting frame");
    expect(category).toBeGreaterThanOrEqual(0);
    expect(ungrouped).toBeGreaterThan(category);
    expect(firstGroup).toBeGreaterThan(ungrouped);
    await act(async () => {});
  });

  it("titles each group beneath its category, one heading level down", async () => {
    registerStreamBackedRows();
    const stream = setupTelemetryStream();
    renderModalWithStream(stream);
    act(() => stream.emitTopic("example.settings", FRAME_PREFS));
    await screen.findByText("Kerbin-centred inertial");

    expect(
      screen.getByRole("heading", { level: 3, name: "Example" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 4, name: "Plotting frame" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 4, name: "Prediction" }),
    ).toBeInTheDocument();
    await act(async () => {});
  });

  it("keeps a group's rows together, in registration order", async () => {
    registerStreamBackedRows();
    const stream = setupTelemetryStream();
    const { container } = renderModalWithStream(stream);
    act(() => stream.emitTopic("example.settings", FRAME_PREFS));
    await screen.findByText("Kerbin-centred inertial");

    const labels = [...container.querySelectorAll("h4, dt")].map(
      (el) => el.textContent ?? "",
    );
    const prediction = labels.indexOf("Prediction");
    expect(labels[prediction + 1]).toContain("Prediction tolerance");
    expect(labels[prediction + 2]).toContain("Max steps");
    await act(async () => {});
  });
});

describe("SettingsModal: typed writable rows", () => {
  it("renders a number preference as a spinbutton and persists what is typed", () => {
    registerSetting({
      id: "example.historyLength",
      type: "number",
      label: "History length",
      category: "Example",
      defaultValue: 30,
      screens: ["main"],
    });
    renderModal("main");

    const input = screen.getByRole("spinbutton", { name: /history length/i });
    expect(input).toHaveValue(30);
    fireEvent.change(input, { target: { value: "45" } });
    expect(
      screen.getByRole("spinbutton", { name: /history length/i }),
    ).toHaveValue(45);
  });

  it("ignores an emptied or part-typed box rather than persisting a zero", () => {
    registerSetting({
      id: "example.historyLength",
      type: "number",
      label: "History length",
      category: "Example",
      defaultValue: 30,
      screens: ["main"],
    });
    renderModal("main");

    const input = screen.getByRole("spinbutton", { name: /history length/i });
    // A number input reports "" for an emptied box AND for anything it cannot
    // parse. `Number("")` is 0, so this is the case that persisted a silent
    // zero before the guard checked for emptiness ahead of the parse.
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.change(input, { target: { value: "not a number" } });
    expect(
      screen.getByRole("spinbutton", { name: /history length/i }),
    ).toHaveValue(30);
  });

  it("renders a text preference as a textbox", () => {
    registerSetting({
      id: "example.callsign",
      type: "text",
      label: "Callsign",
      category: "Example",
      defaultValue: "Houston",
      screens: ["main"],
    });
    renderModal("main");

    const input = screen.getByRole("textbox", { name: /callsign/i });
    expect(input).toHaveValue("Houston");
    fireEvent.change(input, { target: { value: "Capcom" } });
    expect(screen.getByRole("textbox", { name: /callsign/i })).toHaveValue(
      "Capcom",
    );
  });
});

describe("SettingsModal: a row that cannot be written", () => {
  it("renders its value instead of a disabled switch", () => {
    registerSetting({
      id: "build.version",
      type: "text",
      readOnly: true,
      defaultValue: "1.4.2",
      category: "Test",
      label: "Build",
      screens: ["main"],
    });
    renderModal("main");

    expect(screen.getByText("1.4.2").closest("dd")).not.toBeNull();
    expect(screen.queryByRole("checkbox", { name: /build/i })).toBeNull();
  });
});

/*
 * The Loaded clients list is where an operator looks at what is actually
 * running, and it named each Uplink and nothing else: no author, no repo, and
 * no way to tell a mod-vouched name from one a bundle wrote about itself.
 */
describe("SettingsModal: an Uplink page's loaded-client identity", () => {
  it("shows a mod-vouched author and repo against the Uplink that declared them", async () => {
    setUplinkOutcome({
      id: "widget-y",
      name: "Widget Y",
      version: "2.0.0",
      status: "loaded",
      reason: "verified + loaded in 4ms",
      identity: resolveUplinkIdentity(
        "widget-y",
        {
          name: "Widget Y",
          author: "A Stranger",
          repo: "https://example.invalid/stranger/widget-y",
        },
        {},
      ),
    });
    registerDataSource(makeSitrepStub(vi.fn(), "connected"));
    renderModal("main");
    await openUplinkPage("Widget Y");

    expect(screen.getByText("by A Stranger")).toBeInTheDocument();
    expect(
      screen.getByText("https://example.invalid/stranger/widget-y"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Vouched by the installed mod"),
    ).toBeInTheDocument();
  });

  it("shows a self-declared one as the bundle's own claim instead", async () => {
    setUplinkOutcome({
      id: "widget-z",
      name: "Widget Z",
      version: "1.0.0",
      status: "loaded",
      reason: "verified + loaded in 4ms",
      identity: resolveUplinkIdentity(
        "widget-z",
        {},
        { name: "Widget Z", author: "A Stranger" },
      ),
    });
    registerDataSource(makeSitrepStub(vi.fn(), "connected"));
    renderModal("main");
    await openUplinkPage("Widget Z");

    expect(screen.getByText("by A Stranger")).toBeInTheDocument();
    expect(
      screen.getByText("Self-declared by the bundle, unverified"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Vouched by the installed mod"),
    ).not.toBeInTheDocument();
  });

  it("adds no identity line for an Uplink that declared none", async () => {
    setUplinkOutcome({
      id: "widget-q",
      name: "widget-q",
      version: "1.0.0",
      status: "loaded",
      identity: resolveUplinkIdentity("widget-q", {}, {}),
    });
    registerDataSource(makeSitrepStub(vi.fn(), "connected"));
    renderModal("main");
    await openUplinkPage("widget-q");

    expect(screen.getByText("widget-q")).toBeInTheDocument();
    expect(screen.queryByText(/^by /)).not.toBeInTheDocument();
    expect(screen.queryByText(/Vouched by|Self-declared/)).toBeNull();
  });
});

describe("SettingsModal: an Uplink page's client status", () => {
  it("shows a quarantined client with its reason, marks the page, and offers to reconsider a declined consent", async () => {
    setUplinkOutcome({
      id: "widget-d",
      name: "Widget D",
      version: "1.0.0",
      status: "quarantined",
      reason: "consent declined",
    });
    const { container } = renderModal("main");
    const uplinksTab = screen.getByRole("tab", { name: /^Uplinks/ });
    expect(uplinksTab).toHaveAccessibleDescription(/attention/i);
    await openUplinkPage("Widget D");

    expect(screen.getByText("Client")).toBeInTheDocument();
    expect(screen.getByText("quarantined")).toBeInTheDocument();
    expect(screen.getByText("consent declined")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reconsider" }),
    ).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
});

describe("SettingsModal: the Uplinks tab", () => {
  const SURVIVAL_ENTRY = {
    id: "survival",
    name: "Survival",
    version: "1.0.0",
    available: true,
    reason: null,
    modSettings: true,
    health: { state: 0, detail: null },
  };

  const GONOGO_SETTINGS = {
    rows: [
      {
        path: "SIGNAL_DELAY/enabled",
        owner: "gonogo",
        kind: 1,
        label: "Apply light-time delay",
        description: "",
        value: "True",
        default: "True",
      },
      {
        path: "Uplinks/survival/warnOnWear",
        owner: "survival",
        kind: 1,
        label: "Warn on wear",
        description: "",
        value: "False",
        default: "False",
      },
    ],
    persistence: {
      state: 0,
      path: "GameData/Gonogo/PluginData/gonogo.cfg",
      savedAtUt: null,
      reason: null,
    },
    undeclared: [],
  };

  it("has no Uplinks tab while no Uplink has anything to show", () => {
    renderModal("main");
    expect(screen.queryByRole("tab", { name: "Uplinks" })).toBeNull();
  });

  it("draws a row registered for an Uplink on its page, not under General", async () => {
    registerSetting({
      id: "streamer.embeddedFacecams",
      type: "boolean",
      label: "Embedded facecams",
      category: "Streamer",
      uplink: "streamer",
      defaultValue: true,
    });
    renderModal("main");
    expect(
      screen.queryByRole("checkbox", { name: "Embedded facecams" }),
    ).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Uplinks" }));

    expect(
      screen.getByRole("tab", { name: "streamer", selected: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "This screen" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Embedded facecams" }),
    ).toBeInTheDocument();
  });

  it("draws a tab registered for an Uplink as a section of its page, not a tab of its own", async () => {
    registerSettingsTab({
      id: "streamer-panel",
      label: "Streams",
      uplink: "streamer",
      component: () => <div>streamer-panel-content</div>,
    });
    renderModal("main");
    expect(screen.queryByRole("tab", { name: "Streams" })).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Uplinks" }));

    expect(
      screen.getByRole("heading", { name: "Streams" }),
    ).toBeInTheDocument();
    expect(screen.getByText("streamer-panel-content")).toBeInTheDocument();
  });

  it("leads an Uplink's page with its Gonogo rows, then its mod's own settings, under its own name", async () => {
    const stream = setupTelemetryStream();
    registerDataSource(makeSitrepStub(vi.fn(), "connected"));
    renderModalWithStream(stream);
    act(() => {
      stream.emit({ uplinks: [SURVIVAL_ENTRY] });
      stream.emitTopic("settings.gonogo", GONOGO_SETTINGS);
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Uplinks" }));
    expect(
      screen.getByRole("tab", { name: "Survival", selected: true }),
    ).toBeInTheDocument();

    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(headings).toEqual(["Status", "Gonogo", "Survival"]);
    expect(
      screen.getByRole("checkbox", { name: "Warn on wear" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Apply light-time delay" }),
    ).toBeNull();

    act(() =>
      stream.emitTopic("settings.survival", {
        uplink: "survival",
        failure: null,
        settings: [
          {
            id: "mtbfFailures",
            label: "Failures from wear",
            description: "",
            kind: 1,
            unit: null,
            group: "",
            setIn: "Difficulty settings, Survival",
            writable: false,
            value: "True",
            unavailable: null,
          },
        ],
      }),
    );

    expect(await screen.findByText("Failures from wear")).toBeInTheDocument();
    expect(
      screen.getByText("Set in Difficulty settings, Survival"),
    ).toBeInTheDocument();
    await act(async () => {});
  });

  it("marks an Uplink whose Gonogo settings could not be declared", async () => {
    const stream = setupTelemetryStream();
    registerDataSource(makeSitrepStub(vi.fn(), "connected"));
    renderModalWithStream(stream);
    act(() => {
      stream.emit({ uplinks: [{ ...SURVIVAL_ENTRY, modSettings: false }] });
      stream.emitTopic("settings.gonogo", {
        ...GONOGO_SETTINGS,
        rows: GONOGO_SETTINGS.rows.slice(0, 1),
        undeclared: [{ uplinkId: "survival", reason: "declaration threw" }],
      });
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Uplinks" }));

    expect(
      screen.getByText(/could not be read this session \(declaration threw\)/),
    ).toBeInTheDocument();
  });
});
