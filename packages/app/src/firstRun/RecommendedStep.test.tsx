import type { ConfigField, DataSource } from "@ksp-gonogo/core";
import {
  clearRegistry,
  registerDataSource,
  ScreenProvider,
} from "@ksp-gonogo/core";
import { SettingKind, SettingsPersistenceState } from "@ksp-gonogo/sitrep-sdk";
import { setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { say } from "./copy";
import { FirstRunSetup } from "./FirstRunSetup";

const TOPIC = "settings.gonogo";
const RELAY_HEALTH_URL = "http://localhost:3002/health";
const PATH = "Uplinks/widget-a/followHost";
const LABEL = "Follow the host";

const connected: DataSource = {
  id: "sitrep",
  name: "Sitrep Stream",
  status: "connected",
  connect: async () => {},
  disconnect: () => {},
  schema: () => [],
  subscribe: () => () => {},
  configSchema: (): ConfigField[] => [],
  getConfig: () => ({}),
  configure: () => {},
  onStatusChange: () => () => {},
};

function model(value: string) {
  return {
    rows: [
      {
        path: PATH,
        owner: "widget-a",
        kind: SettingKind.Bool,
        label: LABEL,
        description: "",
        value,
        default: "False",
        tags: ["setup"],
      },
    ],
    persistence: {
      state: SettingsPersistenceState.Saved,
      path: "gonogo.cfg",
      savedAtUt: 1,
      reason: null,
    },
    undeclared: [],
  };
}

async function mountOnRecommended() {
  registerDataSource(connected);
  const fixture = setupStreamFixture();
  render(
    <ScreenProvider value="main">
      <fixture.Provider>
        <FirstRunSetup initialStep="recommended" />
      </fixture.Provider>
    </ScreenProvider>,
  );
  await waitFor(() => expect(fixture.transport.isSubscribed(TOPIC)).toBe(true));
  act(() => fixture.emit(TOPIC, model("False")));
  fireEvent.click(await screen.findByRole("checkbox", { name: LABEL }));
  return fixture;
}

/* The Health step the setup moves on to asks the relay at once; answering it lets a test wait for that check to finish. */
const server = setupServer(
  http.get(RELAY_HEALTH_URL, () =>
    HttpResponse.json({ status: "ok", turn: null }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());
beforeEach(() => {
  clearRegistry();
});
afterEach(() => {
  server.resetHandlers();
});

describe("FirstRunSetup: leaving the recommended settings step", () => {
  it("saves a changed setting when the player moves on without pressing Save", async () => {
    const fixture = await mountOnRecommended();
    fixture.transport.setCommandHandler(() => ({ success: true }));

    fireEvent.click(
      screen.getByRole("button", { name: say("recommended.advance") }),
    );

    await screen.findByText(say("health.heading"), { exact: false });
    const [sent] = fixture.transport.sentCommands;
    expect(sent?.command).toBe("settings.save");
    expect(sent?.args).toEqual({ changes: [{ path: PATH, value: "True" }] });
    await screen.findByText(say("container.check.pass"));
  });

  it("stays on the step and says why when the save is refused", async () => {
    const fixture = await mountOnRecommended();
    fixture.transport.setCommandHandler(() => ({
      success: false,
      errorCode: "noVessel",
      detail: "the settings file is read-only",
    }));

    fireEvent.click(
      screen.getByRole("button", { name: say("recommended.advance") }),
    );

    expect(
      await screen.findByText(/Not saved: the settings file is read-only/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(say("recommended.heading"), { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Settings file last saved", { exact: false }),
    ).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: say("recommended.advance") }),
      ).toBeEnabled(),
    );
  });
});
