import type {
  ConfigField,
  DataSource,
  DataSourceStatus,
} from "@ksp-gonogo/core";
import { clearRegistry, registerDataSource } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { ws } from "msw";
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
import {
  __resetUplinkOutcomes,
  setUplinkOutcome,
} from "../uplinks/loaderState";
import { FirstRunSetup } from "./FirstRunSetup";

/**
 * Drives the flow against the real boundaries it uses in the app: a live
 * `system.uplinks` WS stream behind MSW feeding `useUplinkReadiness`, and the
 * real loader-outcome store. Nothing app-side is mocked, so the rows here are
 * the rows an operator gets.
 */

const SITREP_URL = "ws://localhost:8090";
const link = ws.link(SITREP_URL);
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
beforeEach(() => {
  __resetUplinkOutcomes();
  /*
   * Cleared here, not in `afterEach`. RTL's auto-cleanup runs AFTER a user
   * `afterEach`, so a clear written there fires while the previous test's tree
   * is still mounted and notifies live subscribers from outside `act`. By the
   * time this runs, that tree has already been auto-unmounted, so the clear
   * notifies nothing.
   */
  clearRegistry();
});
afterEach(() => {
  server.resetHandlers();
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
 * A fixture shaped like `packages/app/src/dataSources/sitrep.ts`'s singleton,
 * same id/name production uses, so the connect step's embedded
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
  return (
    <SitrepTelemetryProvider enabled host="localhost" port={8090}>
      {children}
    </SitrepTelemetryProvider>
  );
}

/**
 * Registers the WS connection listener BEFORE mounting: `SitrepTelemetryProvider`
 * opens its socket as soon as the wrapper mounts, not when the Uplinks step
 * first subscribes, so a listener added after `render()` would miss it.
 */
function renderSetup(props?: { onFinish?: () => void }) {
  registerDataSource(makeSitrepStub());
  const wsClients: Array<{ send: (data: string) => void }> = [];
  server.use(
    link.addEventListener("connection", ({ client }) => {
      wsClients.push(client as unknown as { send: (data: string) => void });
    }),
  );
  const result = render(<FirstRunSetup {...props} />, { wrapper });
  return { ...result, wsClients };
}

async function goToUplinks() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Get started" }));
  await user.click(screen.getByRole("button", { name: "Check Uplinks" }));
}

async function emitRoster(
  wsClients: Array<{ send: (data: string) => void }>,
  uplinks: unknown[],
) {
  await waitFor(() => expect(wsClients).toHaveLength(1));
  wsClients[0]?.send(streamFrame("system.uplinks", { uplinks }));
}

function rosterEntry(overrides: { id: string } & Record<string, unknown>) {
  return {
    version: "1.0.0",
    available: true,
    reason: null,
    health: { state: 0, detail: null },
    ...overrides,
  };
}

describe("FirstRunSetup: step sequence", () => {
  it("opens on Welcome and walks the four steps", async () => {
    const onFinish = vi.fn();
    const { wsClients } = renderSetup({ onFinish });
    const user = userEvent.setup();

    expect(screen.getByText("Step 1 of 4: Welcome")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Get started" }));

    expect(screen.getByText("Step 2 of 4: Connect")).toBeInTheDocument();
    expect(screen.getByText("Sitrep Stream")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Check Uplinks" }));

    expect(screen.getByText("Step 3 of 4: Uplinks")).toBeInTheDocument();
    await emitRoster(wsClients, []);
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Step 4 of 4: Done")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(onFinish).toHaveBeenCalledTimes(1);
    await act(async () => {});
  });

  it("goes back a step, and offers no Back on the first", async () => {
    renderSetup();
    const user = userEvent.setup();
    expect(
      screen.queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Get started" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Step 1 of 4: Welcome")).toBeInTheDocument();
  });
});

describe("FirstRunSetup: the Uplinks reading", () => {
  it("says it is waiting until the mod answers, never guessing a state first", async () => {
    const { wsClients } = renderSetup();
    await goToUplinks();
    expect(
      screen.getByText("Waiting for the mod to report its Uplinks"),
    ).toBeInTheDocument();
    expect(screen.queryByText("No client loaded")).not.toBeInTheDocument();

    await emitRoster(wsClients, []);
    await waitFor(() =>
      expect(
        screen.getByText("No Uplinks reported by the mod"),
      ).toBeInTheDocument(),
    );
  });

  it("reads one row per Uplink, saying whether its client loaded", async () => {
    setUplinkOutcome({
      id: "widget-loaded",
      name: "Loaded Widget",
      status: "loaded",
    });
    setUplinkOutcome({
      id: "widget-refused",
      name: "Refused Widget",
      status: "quarantined",
      reason: "apiVersion incompatible: host 1.0.0, client built for 2.0.0",
    });
    const { wsClients } = renderSetup();
    await goToUplinks();
    await emitRoster(wsClients, [
      rosterEntry({ id: "widget-loaded" }),
      rosterEntry({ id: "widget-refused" }),
      rosterEntry({ id: "widget-noclient" }),
      rosterEntry({
        id: "widget-off",
        available: false,
        reason: "no antenna in range",
        health: { state: 2, detail: "no antenna in range" },
      }),
    ]);

    // Wait on a ROSTER-derived reading, not an outcome-derived one. The two
    // outcome rows are already in the store before render, so waiting for
    // "Client loaded" resolves before the roster frame has arrived and every
    // assertion below it then reads a list that is still outcome-only.
    await waitFor(() =>
      expect(
        screen.getByText("1 of 4 installed Uplinks have a loaded client"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Client loaded")).toBeInTheDocument();
    expect(screen.getByText("Client quarantined")).toBeInTheDocument();
    expect(
      screen.getByText(
        "apiVersion incompatible: host 1.0.0, client built for 2.0.0",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("No client loaded")).toBeInTheDocument();
    expect(screen.getByText("widget-noclient")).toBeInTheDocument();
    expect(screen.getByText("Mod reports unavailable")).toBeInTheDocument();
    expect(screen.getByText("no antenna in range")).toBeInTheDocument();
  });

  it("shows the declared identity of an Uplink the loader described, and nothing for one it never reached", async () => {
    setUplinkOutcome({
      id: "widget-loaded",
      name: "Loaded Widget",
      status: "loaded",
      identity: {
        name: { value: "Loaded Widget", source: "mod" },
        author: { value: "tester", source: "index" },
        repo: { value: "example/repo", source: "index" },
      },
    });
    const { wsClients } = renderSetup();
    await goToUplinks();
    await emitRoster(wsClients, [
      rosterEntry({ id: "widget-loaded" }),
      rosterEntry({ id: "widget-noclient" }),
    ]);

    await waitFor(() =>
      expect(screen.getByText("by tester")).toBeInTheDocument(),
    );
    expect(screen.getByText("example/repo")).toBeInTheDocument();
    /*
     * The roster carries no name, author or repo, so the row for an Uplink the
     * loader never described has nothing declared to render beside its id.
     */
    expect(screen.getAllByText(/vouched|listed|self-declared/i)).toHaveLength(
      1,
    );
  });

  it("reads out both hashes when a client was refused for disagreeing with the mod", async () => {
    setUplinkOutcome({
      id: "widget-tampered",
      name: "Tampered Widget",
      status: "quarantined",
      reason: "bundle hash does not match",
      integrity: {
        subject: "bundle",
        observed: "sha256-aaa",
        expected: "sha256-bbb",
        vouchedBy: ["installed-mod"],
      },
    });
    const { wsClients } = renderSetup();
    await goToUplinks();
    await emitRoster(wsClients, [rosterEntry({ id: "widget-tampered" })]);

    await waitFor(() =>
      expect(screen.getByText("Client quarantined")).toBeInTheDocument(),
    );
    expect(screen.getByText(/sha256-aaa/)).toBeInTheDocument();
    expect(screen.getByText(/sha256-bbb/)).toBeInTheDocument();
  });
});

describe("FirstRunSetup: accessibility", () => {
  it("has no axe violations on the Welcome step", async () => {
    const { container } = renderSetup();
    await expectNoA11yViolations(container);
  });

  it("has no axe violations on the Connect step", async () => {
    const { container } = renderSetup();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Get started" }));
    await expectNoA11yViolations(container);
  });

  it("has no axe violations on the Uplinks step once the rows have resolved", async () => {
    setUplinkOutcome({
      id: "widget-loaded",
      name: "Loaded Widget",
      status: "loaded",
    });
    const { container, wsClients } = renderSetup();
    await goToUplinks();
    await emitRoster(wsClients, [
      rosterEntry({ id: "widget-loaded" }),
      rosterEntry({ id: "widget-noclient" }),
    ]);
    await waitFor(() =>
      expect(screen.getByText("Client loaded")).toBeInTheDocument(),
    );
    await expectNoA11yViolations(container);
  });
});
