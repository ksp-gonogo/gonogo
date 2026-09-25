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
import { SettingKind, SettingsPersistenceState } from "@ksp-gonogo/sitrep-sdk";
import { setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KspSettings } from "./KspSettings";

const TOPIC = "settings.gonogo";

function sitrep(status: DataSourceStatus): DataSource {
  return {
    id: "sitrep",
    name: "Sitrep Stream",
    status,
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

interface Row {
  path: string;
  owner: string;
  kind: SettingKind;
  label: string;
  value: string;
  default: string;
}

const ROWS: Row[] = [
  {
    path: "SIGNAL_DELAY/enabled",
    owner: "gonogo",
    kind: SettingKind.Bool,
    label: "Apply light-time delay",
    value: "True",
    default: "True",
  },
  {
    path: "SIGNAL_DELAY/lightSpeedScale",
    owner: "gonogo",
    kind: SettingKind.Number,
    label: "Light speed scale",
    value: "1",
    default: "1",
  },
  {
    path: "Uplinks/Rp1/upgradeSlipWarningDays",
    owner: "Rp1",
    kind: SettingKind.Number,
    label: "Slip warning",
    value: "30",
    default: "30",
  },
];

function model(
  rows: Row[] = ROWS,
  persistence: {
    state: SettingsPersistenceState;
    reason?: string | null;
  } = { state: SettingsPersistenceState.Saved },
  undeclared: { uplinkId: string; reason: string }[] = [],
  modSettings: {
    owner: string;
    name: string;
    label: string;
    value: string;
  }[] = [],
) {
  return {
    rows,
    modSettings,
    persistence: {
      state: persistence.state,
      path: "GameData/Gonogo/PluginData/gonogo.cfg",
      savedAtUt: null,
      reason: persistence.reason ?? null,
    },
    undeclared,
  };
}

const unmounts: (() => void)[] = [];

beforeEach(() => {
  clearRegistry();
});

afterEach(() => {
  for (const unmount of unmounts) unmount();
  unmounts.length = 0;
});

function mount(screenName: "main" | "station" = "main") {
  const fixture = setupStreamFixture({ carriedChannels: [TOPIC] });
  const view = render(
    <ScreenProvider value={screenName}>
      <fixture.Provider>
        <KspSettings />
      </fixture.Provider>
    </ScreenProvider>,
  );
  unmounts.push(view.unmount);
  return { fixture, view };
}

async function publish(
  fixture: ReturnType<typeof setupStreamFixture>,
  payload: unknown,
) {
  await waitFor(() => expect(fixture.transport.isSubscribed(TOPIC)).toBe(true));
  act(() => fixture.emit(TOPIC, payload));
}

describe("KspSettings", () => {
  it("draws every declared setting under its owner, from the payload alone", async () => {
    registerDataSource(sitrep("connected"));
    const { fixture } = mount();
    await publish(fixture, model());

    expect(
      await screen.findByRole("heading", { name: "Gonogo" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rp1" })).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Apply light-time delay" }),
    ).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Slip warning" })).toHaveValue(
      "30",
    );
  });

  it("holds an edit until SAVE and sends one press with only what changed", async () => {
    registerDataSource(sitrep("connected"));
    const { fixture } = mount();
    fixture.transport.setCommandHandler(() => ({
      success: true,
      errorCode: 0,
    }));
    await publish(fixture, model());

    const save = await screen.findByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Apply light-time delay" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Slip warning" }), {
      target: { value: "45" },
    });
    expect(fixture.transport.sentCommands).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Save 2 changes" }));

    await waitFor(() => expect(fixture.transport.sentCommands).toHaveLength(1));
    const [sent] = fixture.transport.sentCommands;
    expect(sent?.command).toBe("settings.save");
    expect(sent?.args).toEqual({
      changes: [
        { path: "SIGNAL_DELAY/enabled", value: "False" },
        { path: "Uplinks/Rp1/upgradeSlipWarningDays", value: "45" },
      ],
    });
    await act(async () => {});
  });

  /**
   * The published model is the authority for what was saved, so an edit stays
   * shown as pending until the topic agrees with it.
   */
  it("drops an edit once the published model carries it", async () => {
    registerDataSource(sitrep("connected"));
    const { fixture } = mount();
    await publish(fixture, model());
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Slip warning" }),
      { target: { value: "45" } },
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();

    const saved = ROWS.map((r) =>
      r.path === "Uplinks/Rp1/upgradeSlipWarningDays"
        ? { ...r, value: "45" }
        : r,
    );
    act(() => fixture.emit(TOPIC, model(saved)));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled(),
    );
    expect(screen.getByRole("textbox", { name: "Slip warning" })).toHaveValue(
      "45",
    );
  });

  it("will not offer SAVE for a value its setting cannot hold", async () => {
    registerDataSource(sitrep("connected"));
    const { fixture } = mount();
    await publish(fixture, model());

    fireEvent.change(
      await screen.findByRole("textbox", { name: "Light speed scale" }),
      { target: { value: "fast" } },
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText("Not a number.")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Light speed scale" }),
    ).toHaveAttribute("aria-invalid", "true");
  });

  it("says why the mod refused a save", async () => {
    registerDataSource(sitrep("connected"));
    const { fixture } = mount();
    fixture.transport.setCommandHandler(() => ({
      success: false,
      errorCode: 2,
      detail:
        "Uplinks/Rp1/upgradeSlipWarningDays holds a Number value, not 4 5",
    }));
    await publish(fixture, model());
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Slip warning" }),
      { target: { value: "45" } },
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText(/Not saved: .*holds a Number value/),
    ).toBeInTheDocument();
  });

  /** The ruling: a change with no KSP connection is refused, not queued. */
  it("refuses changes while KSP is not connected", async () => {
    registerDataSource(sitrep("disconnected"));
    const { fixture } = mount();
    await publish(fixture, model());

    expect(
      await screen.findByRole("checkbox", { name: "Apply light-time delay" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(
      screen.getByText("Not connected to KSP, so nothing here can be changed."),
    ).toBeInTheDocument();
  });

  it("says where the settings live when nothing has arrived and KSP is not connected", () => {
    registerDataSource(sitrep("disconnected"));
    mount();

    expect(
      screen.getByText(/can be read and changed only while KSP is connected/),
    ).toBeInTheDocument();
  });

  /** The ruling: a station reads settings, and changes happen on the main screen. */
  it("only reads on a station", async () => {
    const { fixture } = mount("station");
    await publish(fixture, model());

    expect(
      await screen.findByRole("checkbox", { name: "Apply light-time delay" }),
    ).toBeDisabled();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    expect(
      screen.getByText("Settings are changed on the main screen."),
    ).toBeInTheDocument();
  });

  it("stands a line when the file could not be written, naming it and why", async () => {
    registerDataSource(sitrep("connected"));
    const { fixture } = mount();
    await publish(
      fixture,
      model(ROWS, {
        state: SettingsPersistenceState.MemoryOnly,
        reason: "read-only GameData",
      }),
    );

    expect(
      await screen.findByText(
        /Saved for this session only\. GameData\/Gonogo\/PluginData\/gonogo\.cfg could not be written \(read-only GameData\)\. These settings revert when KSP restarts\./,
      ),
    ).toBeInTheDocument();
  });

  it("tells the operator the last session's settings were lost to a recovery", async () => {
    registerDataSource(sitrep("connected"));
    const { fixture } = mount();
    await publish(
      fixture,
      model(ROWS, { state: SettingsPersistenceState.Recovered }),
    );

    expect(
      await screen.findByText(
        /its backup was read\. Anything saved after that backup was taken is lost\./,
      ),
    ).toBeInTheDocument();
  });

  it("names an Uplink whose settings could not be declared", async () => {
    registerDataSource(sitrep("connected"));
    const { fixture } = mount();
    await publish(
      fixture,
      model(ROWS, undefined, [
        { uplinkId: "Broken", reason: "settings declaration threw: typo" },
      ]),
    );

    expect(
      await screen.findByText(
        /Broken's settings could not be read this session/,
      ),
    ).toBeInTheDocument();
  });

  /**
   * What the host mod itself is set to, as its Uplink reads it: shown
   * collapsed, under that Uplink, with no control, because nothing here can
   * change it.
   */
  it("shows a mod's own settings collapsed and read-only under its Uplink", async () => {
    registerDataSource(sitrep("connected"));
    const { fixture, view } = mount();
    await publish(
      fixture,
      model(
        ROWS,
        undefined,
        [],
        [
          {
            owner: "Rp1",
            name: "difficulty",
            label: "Career difficulty",
            value: "Hard",
          },
        ],
      ),
    );

    const summary = await screen.findByText("What Rp1's mod is set to");
    const disclosure = summary.closest("details");
    expect(disclosure).not.toBeNull();
    expect(disclosure).not.toHaveAttribute("open");
    expect(
      disclosure?.querySelector("input, button, [role='switch']"),
    ).toBeNull();
    expect(view.container.textContent).toContain("Career difficulty");
    expect(view.container.textContent).toContain("Hard");
  });

  it("gives an Uplink that only shows its mod's settings a group of its own", async () => {
    registerDataSource(sitrep("connected"));
    const { fixture } = mount();
    await publish(
      fixture,
      model(
        ROWS,
        undefined,
        [],
        [
          {
            owner: "example",
            name: "detail",
            label: "Detail level",
            value: "High",
          },
        ],
      ),
    );

    expect(
      await screen.findByRole("heading", { name: "example" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("What example's mod is set to"),
    ).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    registerDataSource(sitrep("connected"));
    const { fixture, view } = mount();
    await publish(fixture, model());
    await screen.findByRole("heading", { name: "Gonogo" });

    await expectNoA11yViolations(view.container);
  });
});
