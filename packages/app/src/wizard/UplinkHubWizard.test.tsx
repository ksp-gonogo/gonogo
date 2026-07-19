import type {
  ConfigField,
  DataSource,
  DataSourceStatus,
} from "@ksp-gonogo/core";
import { clearRegistry, registerDataSource } from "@ksp-gonogo/core";
import { render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http, ws } from "msw";
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
import { SitrepTelemetryProvider } from "../telemetry/SitrepTelemetryProvider";
import { axe } from "../test/axe";
import { hostCompat } from "../uplinks/hostCompat";
import { loadUplinkById } from "../uplinks/loader";
import type { UplinkLoadOutcome } from "../uplinks/loaderState";
import {
  __resetUplinkOutcomes,
  setUplinkOutcome,
} from "../uplinks/loaderState";
import { VERSION } from "../version";
import { UplinkHubWizard } from "./UplinkHubWizard";

/**
 * Proves the wizard's UI wiring: it drives `useUplinkGap` for real (a live
 * `system.uplinks` WS stream + an MSW-intercepted registry fetch, same
 * boundary `useUplinkGap.integration.test.tsx` already uses) rather than
 * mocking the hook, and only mocks `loadUplinkById` — the loader's own
 * gate/consent/verify/import sequence is exhaustively covered by
 * `loader.test.ts` and re-testing it here would just duplicate that
 * coverage against a slower, harder-to-fail-cleanly boundary (a real bundle
 * fetch + `crypto.subtle` digest + dynamic `import()` of an MSW URL).
 */

vi.mock("../uplinks/loader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../uplinks/loader")>();
  return { ...actual, loadUplinkById: vi.fn() };
});

const mockLoadUplinkById = vi.mocked(loadUplinkById);

const SITREP_URL = "ws://localhost:8090";
const link = ws.link(SITREP_URL);
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
beforeEach(() => {
  __resetUplinkOutcomes();
  mockLoadUplinkById.mockReset();
});
afterEach(() => {
  server.resetHandlers();
  clearRegistry();
});
afterAll(() => server.close());

function streamFrame(topic: string, payload: unknown): string {
  return JSON.stringify({
    type: "stream-data",
    topic,
    payload,
    meta: {
      source: "test",
      validAt: 1,
      seq: 0,
      deliveredAt: 1,
      vantage: "test",
      quality: 0,
      active: false,
      staleness: 0,
      timelineEpoch: 0,
    },
  });
}

/**
 * A fixture shaped like `packages/app/src/dataSources/sitrep.ts`'s singleton
 * — same id/name production uses — so `SetupAssistStep`'s embedded
 * `SitrepConnection` has something to render.
 */
function makeSitrepStub(): DataSource {
  return {
    id: "sitrep",
    name: "Sitrep Stream",
    status: "disconnected" as DataSourceStatus,
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    subscribe: () => () => {},
    execute: async () => {},
    configSchema: (): ConfigField[] => [],
    getConfig: () => ({}),
    configure: () => {},
    onStatusChange: () => () => {},
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <SitrepTelemetryProvider enabled host="localhost" port={8090}>
        {children}
      </SitrepTelemetryProvider>
    </QueryClientProvider>
  );
}

/**
 * Registers the WS connection listener BEFORE mounting — `SitrepTelemetryProvider`
 * opens its socket as soon as the wrapper mounts (not when the Results step
 * first subscribes), so a listener added after `render()` would miss the
 * connection.
 */
function renderWizard(props?: { firstRun?: boolean; onFinish?: () => void }) {
  registerDataSource(makeSitrepStub());
  const wsClients: Array<{ send: (data: string) => void }> = [];
  server.use(
    link.addEventListener("connection", ({ client }) => {
      wsClients.push(client as unknown as { send: (data: string) => void });
    }),
  );
  const result = render(<UplinkHubWizard {...props} />, { wrapper });
  return { ...result, wsClients };
}

function serveRegistry(body: Record<string, unknown>) {
  server.use(
    http.get("*/uplinks/registry.local.json", () => HttpResponse.json(body)),
  );
}

function failRegistry() {
  server.use(
    http.get("*/uplinks/registry.local.json", () => HttpResponse.error()),
  );
}

async function goToResults() {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: /next: check uplinks/i }),
  );
}

async function emitRoster(
  wsClients: Array<{ send: (data: string) => void }>,
  uplinks: unknown[],
) {
  await waitFor(() => expect(wsClients).toHaveLength(1));
  wsClients[0]?.send(streamFrame("system.uplinks", { uplinks }));
}

describe("UplinkHubWizard — setup-assist step", () => {
  it("shows the setup-assist step first, embedding SitrepConnection", () => {
    renderWizard();
    expect(screen.getByText("Sitrep Stream")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /next: check uplinks/i }),
    ).toBeInTheDocument();
  });
});

describe("UplinkHubWizard — results step", () => {
  it("shows a checking state until the roster resolves, never flashing a wrong state", async () => {
    serveRegistry({ uplinks: [] });
    const { wsClients } = renderWizard();
    await goToResults();
    expect(screen.getByText(/checking installed uplinks/i)).toBeInTheDocument();
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();

    await emitRoster(wsClients, []);
    await waitFor(() =>
      expect(
        screen.getByText(/no uplinks reported by the mod yet/i),
      ).toBeInTheDocument(),
    );
  });

  it("renders one row per resolved gap state with the matching affordance", async () => {
    // `computeUplinkGap` names a row from the Hub descriptor when one exists,
    // falling back to the raw id otherwise (`useUplinkGap.test.ts` already
    // covers that fallback) — "widget-loaded" has no Hub descriptor here, so
    // the row is named "widget-loaded", not this outcome's `name` field.
    setUplinkOutcome({
      id: "widget-loaded",
      name: "Loaded Widget",
      status: "loaded",
    });
    serveRegistry({
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
              bundleUrl: "/uplinks/hub-widget.client.js",
              integrity: "sha256-fake",
            },
          ],
        },
      ],
    });
    const { wsClients } = renderWizard();
    await goToResults();
    await emitRoster(wsClients, [
      {
        id: "widget-loaded",
        version: "1.0.0",
        available: true,
        reason: null,
        health: { state: 0, detail: null },
      },
      {
        id: "widget-hub",
        version: "1.0.0",
        available: true,
        reason: null,
        health: { state: 0, detail: null },
      },
      {
        id: "widget-noclient",
        version: "1.0.0",
        available: true,
        reason: null,
        health: { state: 0, detail: null },
      },
      {
        id: "widget-bad",
        version: "1.0.0",
        available: false,
        reason: "no antenna in range",
        health: { state: 2, detail: "no antenna in range" },
      },
    ]);

    await waitFor(() =>
      expect(screen.getByText("widget-loaded")).toBeInTheDocument(),
    );
    expect(screen.getByText("Loaded")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /load hub widget/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/installed in ksp, no downloadable client/i),
    ).toBeInTheDocument();
    expect(screen.getByText("no antenna in range")).toBeInTheDocument();
  });

  it("distinguishes a Hub fetch failure ('hub-unknown') from a confirmed 'no client'", async () => {
    failRegistry();
    const { wsClients } = renderWizard();
    await goToResults();
    await emitRoster(wsClients, [
      {
        id: "widget-a",
        version: "1.0.0",
        available: true,
        reason: null,
        health: { state: 0, detail: null },
      },
    ]);

    await waitFor(() =>
      expect(screen.getByText(/couldn't reach the hub/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/hub unavailable:/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/no downloadable client/i),
    ).not.toBeInTheDocument();
  });
});

describe("UplinkHubWizard — Load action", () => {
  async function setUpLoadableRow() {
    serveRegistry({
      uplinks: [
        {
          id: "widget-hub",
          name: "Hub Widget",
          author: "tester",
          repo: "example/repo",
          versions: [],
        },
      ],
    });
    const { wsClients } = renderWizard();
    await goToResults();
    await emitRoster(wsClients, [
      {
        id: "widget-hub",
        version: "1.0.0",
        available: true,
        reason: null,
        health: { state: 0, detail: null },
      },
    ]);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /load hub widget/i }),
      ).toBeInTheDocument(),
    );
  }

  it("on success, calls loadUplinkById with the resolved id/hub context, then re-derives to 'loaded' via loaderState", async () => {
    mockLoadUplinkById.mockImplementation(async (id) => {
      const outcome: UplinkLoadOutcome = {
        id,
        name: "Hub Widget",
        version: "1.0.0",
        status: "loaded",
        reason: "verified + loaded",
      };
      setUplinkOutcome(outcome);
      return outcome;
    });

    await setUpLoadableRow();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /load hub widget/i }));

    expect(mockLoadUplinkById).toHaveBeenCalledWith(
      "widget-hub",
      expect.objectContaining({
        enabledIds: ["widget-hub"],
        hostCompat,
        appVersion: VERSION,
        registrySource: expect.objectContaining({
          url: expect.stringContaining("registry.local.json"),
        }),
      }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /load hub widget/i }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Loaded")).toBeInTheDocument();
  });

  it("on failure, surfaces the outcome's reason verbatim and leaves the Load affordance in place", async () => {
    mockLoadUplinkById.mockResolvedValue({
      id: "widget-hub",
      name: "Hub Widget",
      status: "quarantined",
      reason: "apiVersion incompatible: host 1.0.0, client built for 2.0.0",
    });

    await setUpLoadableRow();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /load hub widget/i }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "apiVersion incompatible: host 1.0.0, client built for 2.0.0",
        ),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /load hub widget/i }),
    ).toBeInTheDocument();
  });
});

describe("UplinkHubWizard — accessibility", () => {
  it("has no axe violations on the setup-assist step", async () => {
    const { container } = renderWizard();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations on the results step once entries have resolved", async () => {
    serveRegistry({ uplinks: [] });
    const { container, wsClients } = renderWizard();
    await goToResults();
    await emitRoster(wsClients, []);
    await waitFor(() =>
      expect(
        screen.getByText(/no uplinks reported by the mod yet/i),
      ).toBeInTheDocument(),
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("UplinkHubWizard — firstRun bookends (Welcome/Done)", () => {
  it("starts on Welcome, not Setup, when firstRun is true", () => {
    renderWizard({ firstRun: true });
    expect(
      screen.getByRole("button", { name: /get started/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /next: check uplinks/i }),
    ).not.toBeInTheDocument();
  });

  it("walks Welcome -> Setup -> Results -> Done and calls onFinish on Close", async () => {
    serveRegistry({ uplinks: [] });
    const onFinish = vi.fn();
    const { wsClients } = renderWizard({ firstRun: true, onFinish });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /get started/i }));
    expect(screen.getByText("Sitrep Stream")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /next: check uplinks/i }),
    );
    await emitRoster(wsClients, []);
    await waitFor(() =>
      expect(
        screen.getByText(/no uplinks reported by the mod yet/i),
      ).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /finish/i }));
    expect(
      screen.getByText(
        /reopen this any time from the uplink hub tab in settings/i,
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("does not add the firstRun bookends for the persistent entry point (default props)", () => {
    renderWizard();
    expect(
      screen.queryByRole("button", { name: /get started/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /next: check uplinks/i }),
    ).toBeInTheDocument();
  });

  it("has no axe violations on the Welcome step", async () => {
    const { container } = renderWizard({ firstRun: true });
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations on the Done step", async () => {
    serveRegistry({ uplinks: [] });
    const { container, wsClients } = renderWizard({ firstRun: true });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /get started/i }));
    await user.click(
      screen.getByRole("button", { name: /next: check uplinks/i }),
    );
    await emitRoster(wsClients, []);
    await waitFor(() =>
      expect(
        screen.getByText(/no uplinks reported by the mod yet/i),
      ).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: /finish/i }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
