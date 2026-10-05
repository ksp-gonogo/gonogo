import type {
  ConfigField,
  DataSource,
  DataSourceStatus,
} from "@ksp-gonogo/core";
import { clearRegistry, registerDataSource } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
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
import type { LinkClient } from "../test/peerFakes";
import {
  __resetUplinkOutcomes,
  setUplinkOutcome,
} from "../uplinks/loaderState";
import { type CopyRun, runs, say } from "./copy";
import { FirstRunSetup } from "./FirstRunSetup";
import {
  CKAN_UPLINK_FILTER,
  CONTAINER_LOGS_COMMAND,
  CONTAINER_STATUS_COMMAND,
  MOD_LOG_COMMAND,
  RUN_COMMAND,
  SETUP_LINKS,
} from "./setupGuide";

function stepHeading(index: number, heading: string): string {
  return say("shell.stepHeading", { index, total: 6, heading });
}

/** The words one of a sentence's links is drawn with. */
function linkWords(sentence: readonly CopyRun[], link: string): string {
  return sentence.find((run) => run.link === link)?.text ?? "";
}

/**
 * Drives the flow against the real boundaries it uses in the app: a live
 * `system.uplinks` WS stream behind MSW feeding `useUplinkReadiness`, and the
 * real loader-outcome store. Nothing app-side is mocked, so the rows here are
 * the rows an operator gets.
 */

const SITREP_URL = "ws://localhost:8090";
const RELAY_HEALTH_URL = "http://localhost:3002/health";
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
function makeSitrepStub(status: DataSourceStatus): DataSource {
  return {
    id: "sitrep",
    name: "Sitrep Stream",
    status,
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    subscribe: () => () => {},
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
function renderSetup(
  props?: { onFinish?: () => void },
  world: { relay?: "up" | "down"; ksp?: DataSourceStatus } = {},
) {
  registerDataSource(makeSitrepStub(world.ksp ?? "disconnected"));
  const wsClients: LinkClient[] = [];
  server.use(
    http.get(RELAY_HEALTH_URL, () =>
      world.relay === "down"
        ? HttpResponse.error()
        : HttpResponse.json({ status: "ok", turn: null }),
    ),
    link.addEventListener("connection", ({ client }) => {
      wsClients.push(client);
    }),
  );
  const result = render(<FirstRunSetup {...props} />, { wrapper });
  return { ...result, wsClients };
}

async function goToUplinks() {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: say("welcome.advance") }),
  );
  await user.click(
    screen.getByRole("button", { name: say("container.advance") }),
  );
  await user.click(
    screen.getByRole("button", { name: say("connect.advance") }),
  );
}

async function goToHealth() {
  await goToUplinks();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: say("uplinks.advance") }));
}

async function emitRoster(wsClients: LinkClient[], uplinks: unknown[]) {
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
  it("opens on Welcome and walks the six steps", async () => {
    const onFinish = vi.fn();
    const { wsClients } = renderSetup({ onFinish });
    const user = userEvent.setup();

    expect(
      screen.getByText(stepHeading(1, say("welcome.heading"))),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: say("welcome.advance") }),
    );

    expect(
      screen.getByText(stepHeading(2, say("container.heading"))),
    ).toBeInTheDocument();
    await screen.findByText(say("container.check.pass"));
    await user.click(
      screen.getByRole("button", { name: say("container.advance") }),
    );

    expect(
      screen.getByText(stepHeading(3, say("connect.heading"))),
    ).toBeInTheDocument();
    expect(screen.getByText("Sitrep Stream")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: say("connect.advance") }),
    );

    expect(
      screen.getByText(stepHeading(4, say("uplinks.heading"))),
    ).toBeInTheDocument();
    await emitRoster(wsClients, []);
    await user.click(
      screen.getByRole("button", { name: say("uplinks.advance") }),
    );

    expect(
      screen.getByText(stepHeading(5, say("health.heading"))),
    ).toBeInTheDocument();
    await screen.findByText(say("container.check.pass"));
    await user.click(
      screen.getByRole("button", { name: say("health.advance") }),
    );

    expect(
      screen.getByText(stepHeading(6, say("done.heading"))),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: say("done.advance") }));
    expect(onFinish).toHaveBeenCalledTimes(1);
    await act(async () => {});
  });

  it("goes back a step, and offers no Back on the first", async () => {
    renderSetup();
    const user = userEvent.setup();
    expect(
      screen.queryByRole("button", { name: say("shell.back") }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: say("welcome.advance") }),
    );
    await screen.findByText(say("container.check.pass"));
    await user.click(screen.getByRole("button", { name: say("shell.back") }));
    expect(
      screen.getByText(stepHeading(1, say("welcome.heading"))),
    ).toBeInTheDocument();
  });
});

describe("FirstRunSetup: the container check", () => {
  it("prints the run command and confirms the container by itself", async () => {
    renderSetup();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: say("welcome.advance") }));

    expect(screen.getByText(RUN_COMMAND)).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: `Copy ${say("container.runCommandLabel")}`,
      }),
    ).toBeInTheDocument();
    await screen.findByText(say("container.check.pass"));
    expect(
      screen.queryByText(CONTAINER_STATUS_COMMAND),
    ).not.toBeInTheDocument();
  });

  it("says what to run and where to read more when nothing answers", async () => {
    renderSetup(undefined, { relay: "down" });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: say("welcome.advance") }));

    await screen.findByText(
      say("container.check.fail", { url: "http://localhost:3002" }),
    );
    expect(screen.getByText(CONTAINER_STATUS_COMMAND)).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: linkWords(runs("container.hint.fix"), "deployment"),
      }),
    ).toHaveAttribute("href", SETUP_LINKS.deployment);
    expect(
      screen.getByRole("button", { name: say("container.recheck") }),
    ).toBeInTheDocument();
  });

  it("picks up a container started after the step opened, on Check again", async () => {
    renderSetup(undefined, { relay: "down" });
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: say("welcome.advance") }),
    );
    await screen.findByText(
      say("container.check.fail", { url: "http://localhost:3002" }),
    );

    server.use(
      http.get(RELAY_HEALTH_URL, () =>
        HttpResponse.json({ status: "ok", turn: null }),
      ),
    );
    await user.click(
      screen.getByRole("button", { name: say("container.recheck") }),
    );
    await screen.findByText(say("container.check.pass"));
  });
});

describe("FirstRunSetup: the KSP connection check", () => {
  async function goToConnect() {
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: say("welcome.advance") }),
    );
    await screen.findByText(say("container.check.pass"));
    await user.click(
      screen.getByRole("button", { name: say("container.advance") }),
    );
  }

  it("names the three causes, each with its way out, while there is no connection", async () => {
    renderSetup();
    await goToConnect();

    expect(
      screen.getByText(
        say("connect.check.fail", { address: "localhost:8090" }),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(MOD_LOG_COMMAND.posix)).toBeInTheDocument();
    expect(screen.getByText(/KSP is not running yet/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: linkWords(runs("connect.hint.notInstalled"), "kspSetup"),
      }),
    ).toHaveAttribute("href", SETUP_LINKS.kspSetup);
    expect(
      screen.getByRole("link", {
        name: linkWords(runs("connect.hint.blocked"), "networking"),
      }),
    ).toHaveAttribute("href", SETUP_LINKS.networking);
  });

  it("reads connected and drops the hints once the mod answers", async () => {
    renderSetup(undefined, { ksp: "connected" });
    await goToConnect();

    expect(
      screen.getByText(
        say("connect.check.pass", { address: "localhost:8090" }),
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", {
        name: linkWords(runs("connect.hint.blocked"), "networking"),
      }),
    ).not.toBeInTheDocument();
  });
});

describe("FirstRunSetup: the health check", () => {
  it("reports all three checks in one place and says so when all pass", async () => {
    const { wsClients } = renderSetup(undefined, { ksp: "connected" });
    await goToUplinks();
    await emitRoster(wsClients, []);
    await screen.findByText(say("uplinks.check.none"));
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: say("uplinks.advance") }));

    await screen.findByText(say("health.verdict.allWorking"));
    expect(screen.getByText(say("container.check.pass"))).toBeInTheDocument();
    expect(
      screen.getByText(
        say("connect.check.pass", { address: "localhost:8090" }),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(CONTAINER_LOGS_COMMAND)).not.toBeInTheDocument();
  });

  it("counts what needs a look and offers the log command and the guides", async () => {
    const { wsClients } = renderSetup(undefined, { relay: "down" });
    await goToHealth();
    await emitRoster(wsClients, []);

    await screen.findByText(
      say("health.verdict.needLook", { bad: 2, total: 3 }),
    );
    expect(screen.getByText(CONTAINER_LOGS_COMMAND)).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: linkWords(runs("health.hint.guides"), "telemetryChecks"),
      }),
    ).toHaveAttribute("href", SETUP_LINKS.telemetryChecks);
  });

  it("sends an Uplink problem back to the Uplinks step, not to the container log", async () => {
    const { wsClients } = renderSetup(undefined, { ksp: "connected" });
    await goToHealth();
    await emitRoster(wsClients, [rosterEntry({ id: "widget-noclient" })]);

    await screen.findByText(
      say("health.verdict.needLook", { bad: 1, total: 3 }),
    );
    expect(screen.getByText(/Go back to the Uplinks step/)).toBeInTheDocument();
    expect(screen.queryByText(CONTAINER_LOGS_COMMAND)).not.toBeInTheDocument();
  });
});

describe("FirstRunSetup: the Uplinks reading", () => {
  it("says it is waiting until the mod answers, never guessing a state first", async () => {
    const { wsClients } = renderSetup();
    await goToUplinks();
    expect(screen.getByText(say("uplinks.check.waiting"))).toBeInTheDocument();
    expect(
      screen.queryByText(say("uplinks.row.noClient")),
    ).not.toBeInTheDocument();

    await emitRoster(wsClients, []);
    await screen.findByText(say("uplinks.check.none"));
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
        screen.getByText(say("uplinks.summary", { loaded: 1, installed: 4 })),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(say("uplinks.row.loaded"))).toBeInTheDocument();
    expect(
      screen.getByText(say("uplinks.row.quarantined")),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "apiVersion incompatible: host 1.0.0, client built for 2.0.0",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(say("uplinks.row.noClient"))).toBeInTheDocument();
    expect(screen.getByText("widget-noclient")).toBeInTheDocument();
    expect(
      screen.getByText(say("uplinks.row.unavailable")),
    ).toBeInTheDocument();
    expect(screen.getByText("no antenna in range")).toBeInTheDocument();
    expect(
      screen.getByText(
        say("uplinks.check.attention", { installed: 4, attention: 3 }),
      ),
    ).toBeInTheDocument();
  });

  it("shows each Uplink's own health report: its state, what it says, and its facts", async () => {
    setUplinkOutcome({ id: "cameras", name: "cameras", status: "loaded" });
    const { wsClients } = renderSetup();
    await goToUplinks();
    await emitRoster(wsClients, [
      rosterEntry({
        id: "cameras",
        health: {
          state: 1,
          detail: "No camera on the active craft",
          facts: [{ label: "Sidecar", value: "listening on 8088" }],
        },
      }),
    ]);

    await screen.findByText(say("uplinks.check.allWorking", { installed: 1 }));
    expect(screen.getByText("degraded")).toBeInTheDocument();
    expect(
      screen.getByText("No camera on the active craft"),
    ).toBeInTheDocument();
    expect(screen.getByText("Sidecar")).toBeInTheDocument();
    expect(screen.getByText("listening on 8088")).toBeInTheDocument();
  });

  it("prints the CKAN search that lists Uplinks, and never calls one required", async () => {
    renderSetup();
    await goToUplinks();

    expect(screen.getByText(CKAN_UPLINK_FILTER)).toBeInTheDocument();
    expect(
      screen.getByText(/Uplinks are optional add-ons/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: linkWords(runs("uplinks.install"), "ckanUserGuide"),
      }),
    ).toHaveAttribute("href", SETUP_LINKS.ckanUserGuide);
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

    /*
     * The roster count, not the identity: the identity comes from an outcome
     * already in the store before render, so it is on screen before the
     * roster frame that adds the row it is compared against.
     */
    await screen.findByText(
      say("uplinks.summary", { loaded: 1, installed: 2 }),
    );
    expect(screen.getByText("widget-noclient")).toBeInTheDocument();
    expect(screen.getByText("by tester")).toBeInTheDocument();
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

    await screen.findByText(
      say("uplinks.summary", { loaded: 0, installed: 1 }),
    );
    expect(
      screen.getByText(say("uplinks.row.quarantined")),
    ).toBeInTheDocument();
    expect(screen.getByText(/sha256-aaa/)).toBeInTheDocument();
    expect(screen.getByText(/sha256-bbb/)).toBeInTheDocument();
  });
});

describe("FirstRunSetup: accessibility", () => {
  it("has no axe violations on the Welcome step", async () => {
    const { container } = renderSetup();
    await expectNoA11yViolations(container);
  });

  it("has no axe violations on the container step, passing and failing", async () => {
    const passing = renderSetup();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: say("welcome.advance") }));
    await screen.findByText(say("container.check.pass"));
    await expectNoA11yViolations(passing.container);
    passing.unmount();

    const failing = renderSetup(undefined, { relay: "down" });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: say("welcome.advance") }));
    await screen.findByRole("button", { name: say("container.recheck") });
    await expectNoA11yViolations(failing.container);
  });

  it("has no axe violations on the Connect step with its failure hints open", async () => {
    const { container } = renderSetup();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: say("welcome.advance") }),
    );
    await user.click(
      screen.getByRole("button", { name: say("container.advance") }),
    );
    expect(
      screen.getByRole("link", {
        name: linkWords(runs("connect.hint.blocked"), "networking"),
      }),
    ).toBeInTheDocument();
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
    await screen.findByText(
      say("uplinks.summary", { loaded: 1, installed: 2 }),
    );
    expect(screen.getByText(say("uplinks.row.loaded"))).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("has no axe violations on the health step with something to fix", async () => {
    const { container, wsClients } = renderSetup(undefined, { relay: "down" });
    await goToHealth();
    await emitRoster(wsClients, []);
    await screen.findByText(
      say("health.verdict.needLook", { bad: 2, total: 3 }),
    );
    await expectNoA11yViolations(container);
  });

  it("has no axe violations on the Done step", async () => {
    const { container, wsClients } = renderSetup();
    await goToHealth();
    await emitRoster(wsClients, []);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: say("health.advance") }));
    expect(
      screen.getByText(stepHeading(6, say("done.heading"))),
    ).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
});
