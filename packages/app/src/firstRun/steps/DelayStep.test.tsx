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
import { type ModSettingRow, SettingKind } from "@ksp-gonogo/sitrep-sdk";
import { setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { DelayStep } from "./DelayStep";

function sitrep(status: DataSourceStatus): DataSource {
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

function delayRow(fields: Partial<ModSettingRow>): ModSettingRow {
  return {
    id: "delayEnabled",
    label: "Signal delay",
    description: "",
    kind: SettingKind.Bool,
    unit: null,
    group: "",
    setIn: "Difficulty settings, Gonogo",
    tags: [],
    lockedBy: null,
    lockReason: null,
    writable: true,
    value: "True",
    unavailable: null,
    ...fields,
  };
}

function mount() {
  const fixture = setupStreamFixture();
  const view = render(
    <ScreenProvider value="main">
      <fixture.Provider>
        <DelayStep />
      </fixture.Provider>
    </ScreenProvider>,
  );
  const publish = async (...rows: ModSettingRow[]) => {
    await waitFor(() =>
      expect(fixture.transport.isSubscribed("system.uplinks")).toBe(true),
    );
    act(() =>
      fixture.emit("system.uplinks", {
        uplinks: [
          {
            id: "comms",
            name: null,
            version: "1.0.0",
            available: true,
            reason: null,
            modSettings: true,
            bundled: true,
            health: { state: 0, detail: null },
          },
        ],
      }),
    );
    await waitFor(() =>
      expect(fixture.transport.isSubscribed("settings.comms")).toBe(true),
    );
    act(() =>
      fixture.emit("settings.comms", {
        uplink: "comms",
        settings: rows,
        failure: null,
      }),
    );
  };
  return { fixture, view, publish };
}

describe("the signal delay step", () => {
  beforeEach(() => {
    clearRegistry();
    registerDataSource(sitrep("connected"));
  });

  it("turns signal delay off in the loaded save through the mod", async () => {
    const { fixture, view, publish } = mount();
    await publish(delayRow({}));

    const toggle = await screen.findByRole("checkbox", {
      name: "Signal delay",
    });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);

    await waitFor(() => expect(fixture.transport.sentCommands).toHaveLength(1));
    const [sent] = fixture.transport.sentCommands;
    expect(sent?.command).toBe("settings.mod.write");
    expect(sent?.args).toEqual({
      uplink: "comms",
      id: "delayEnabled",
      value: "False",
    });
    await expectNoA11yViolations(view.container);
  });

  it("leaves a comms setting tagged for the recommended settings step to that step", async () => {
    const { publish } = mount();
    await publish(
      delayRow({}),
      delayRow({
        id: "telemetryRequiresCharge",
        label: "Vessel telemetry requires vessel charge",
        tags: ["setup"],
      }),
    );

    expect(
      await screen.findByRole("checkbox", { name: "Signal delay" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Vessel telemetry requires vessel charge"),
    ).toBeNull();
  });

  it("offers no switch until a save is loaded", async () => {
    const { publish } = mount();
    await publish(delayRow({ value: null, unavailable: "no save is loaded" }));

    expect(await screen.findByText("no save is loaded")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Signal delay" })).toBeNull();
  });
});
