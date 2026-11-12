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
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModSettingsSection } from "./ModSettingsSection";

const TOPIC = "settings.streamer";

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

function row(fields: Partial<ModSettingRow> & { id: string }): ModSettingRow {
  return {
    label: fields.id,
    description: "",
    kind: SettingKind.Bool,
    unit: null,
    group: "",
    setIn: "",
    tags: [],
    lockedBy: null,
    lockReason: null,
    writable: false,
    value: null,
    unavailable: null,
    ...fields,
  };
}

const THROTTLE = row({
  id: "throttleMainRender",
  label: "Throttle KSP main render",
  writable: true,
  value: "False",
});

function model(settings: ModSettingRow[], failure: string | null = null) {
  return { uplink: "streamer", settings, failure };
}

const unmounts: (() => void)[] = [];

beforeEach(() => {
  clearRegistry();
});

afterEach(() => {
  for (const unmount of unmounts) unmount();
  unmounts.length = 0;
});

function mount(
  screenName: "main" | "station" = "main",
  filter: { tag?: string; withoutTag?: string } = {},
) {
  const fixture = setupStreamFixture();
  const view = render(
    <ScreenProvider value={screenName}>
      <fixture.Provider>
        <ModSettingsSection uplinkId="streamer" name="Streamer" {...filter} />
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

describe("ModSettingsSection", () => {
  it("draws a switch an Uplink locks at its value and disabled, with the Uplink and its reason under it", async () => {
    registerDataSource(sitrep("connected"));
    const { fixture, view } = mount();
    await publish(
      fixture,
      model([
        row({
          id: "telemetryRequiresCharge",
          label: "Vessel telemetry requires vessel charge",
          writable: true,
          value: "True",
          setIn: "Difficulty settings, Gonogo",
          lockedBy: "Example Antennas",
          lockReason:
            "Example Antennas already cuts the link of a craft with no charge",
        }),
      ]),
    );

    expect(
      await screen.findByText("Vessel telemetry requires vessel charge"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Set by the Example Antennas Uplink: Example Antennas already cuts the link of a craft with no charge",
      ),
    ).toBeInTheDocument();
    const toggle = screen.getByRole("checkbox", {
      name: "Vessel telemetry requires vessel charge",
    });
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(toggle);
    expect(fixture.transport.sentCommands).toHaveLength(0);
    await expectNoA11yViolations(view.container);
  });

  it("draws only the settings carrying the tag it is given", async () => {
    registerDataSource(sitrep("connected"));
    const { fixture } = mount("main", { tag: "setup" });
    await publish(
      fixture,
      model([
        row({ id: "charge", label: "Tagged", value: "True", tags: ["setup"] }),
        row({ id: "delay", label: "Untagged", value: "True" }),
      ]),
    );

    expect(await screen.findByText("Tagged")).toBeInTheDocument();
    expect(screen.queryByText("Untagged")).toBeNull();
  });

  it("leaves out the settings carrying the tag it is told to leave out", async () => {
    registerDataSource(sitrep("connected"));
    const { fixture } = mount("main", { withoutTag: "setup" });
    await publish(
      fixture,
      model([
        row({ id: "charge", label: "Tagged", value: "True", tags: ["setup"] }),
        row({ id: "delay", label: "Untagged", value: "True" }),
      ]),
    );

    expect(await screen.findByText("Untagged")).toBeInTheDocument();
    expect(screen.queryByText("Tagged")).toBeNull();
  });

  it("draws a setting the Uplink does not offer to write as a value, never a control", async () => {
    registerDataSource(sitrep("connected"));
    const { fixture, view } = mount();
    await publish(
      fixture,
      model([
        row({
          id: "reliability",
          label: "Part reliability",
          value: "True",
          setIn: "Survival profile",
        }),
      ]),
    );

    expect(await screen.findByText("Part reliability")).toBeInTheDocument();
    expect(screen.getByText("On")).toBeInTheDocument();
    expect(screen.getByText("Set in Survival profile")).toBeInTheDocument();
    expect(view.container.querySelector("input, button")).toBeNull();
  });

  it("draws a number through its unit", async () => {
    registerDataSource(sitrep("connected"));
    const { fixture } = mount();
    await publish(
      fixture,
      model([
        row({
          id: "criticalChance",
          label: "Critical failure chance",
          kind: SettingKind.Number,
          unit: "ratio",
          value: "0.25",
        }),
      ]),
    );

    expect(await screen.findByText(/25/)).toBeInTheDocument();
  });

  it("shows the null placeholder and the reason for a setting it cannot read", async () => {
    registerDataSource(sitrep("connected"));
    const { fixture } = mount();
    await publish(
      fixture,
      model([
        row({
          id: "mtbfFailures",
          label: "Failures from wear",
          unavailable: "no save loaded",
        }),
      ]),
    );

    expect(await screen.findByText("no save loaded")).toBeInTheDocument();
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
  });

  it("files grouped settings under their group", async () => {
    registerDataSource(sitrep("connected"));
    const { fixture } = mount();
    await publish(
      fixture,
      model([
        row({ id: "a", label: "Part reliability", group: "Reliability" }),
      ]),
    );

    expect(
      await screen.findByRole("heading", { name: "Reliability", level: 4 }),
    ).toBeInTheDocument();
  });

  it("writes an offered setting at once, and shows what the topic then says", async () => {
    registerDataSource(sitrep("connected"));
    const { fixture } = mount();
    fixture.transport.setCommandHandler(() => ({ success: true }));
    await publish(fixture, model([THROTTLE]));

    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Throttle KSP main render" }),
    );

    await waitFor(() => expect(fixture.transport.sentCommands).toHaveLength(1));
    const [sent] = fixture.transport.sentCommands;
    expect(sent?.command).toBe("settings.mod.write");
    expect(sent?.args).toEqual({
      uplink: "streamer",
      id: "throttleMainRender",
      value: "True",
    });

    act(() => fixture.emit(TOPIC, model([{ ...THROTTLE, value: "True" }])));
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Throttle KSP main render" }),
      ).toBeEnabled(),
    );
    expect(
      screen.getByRole("checkbox", { name: "Throttle KSP main render" }),
    ).toBeChecked();
  });

  it("says why a write was refused and shows what the mod still holds", async () => {
    registerDataSource(sitrep("connected"));
    const { fixture } = mount();
    fixture.transport.setCommandHandler(() => ({
      success: false,
      errorCode: "wrongScene",
      detail: "not in flight",
    }));
    await publish(fixture, model([THROTTLE]));

    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Throttle KSP main render" }),
    );

    expect(
      await screen.findByText(
        "Throttle KSP main render not changed: not in flight.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Throttle KSP main render" }),
    ).not.toBeChecked();
  });

  it("only reads on a station", async () => {
    const { fixture } = mount("station");
    await publish(fixture, model([THROTTLE]));

    expect(
      await screen.findByRole("checkbox", { name: "Throttle KSP main render" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("says why the Uplink could not list its settings", async () => {
    registerDataSource(sitrep("connected"));
    const { fixture } = mount();
    await publish(fixture, model([], "listing its mod settings threw: typo"));

    expect(
      await screen.findByText(
        /Streamer's settings could not be read this session \(listing its mod settings threw: typo\)/,
      ),
    ).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    registerDataSource(sitrep("connected"));
    const { fixture, view } = mount();
    await publish(
      fixture,
      model([
        THROTTLE,
        row({ id: "reliability", label: "Part reliability", value: "True" }),
      ]),
    );
    await screen.findByText("Part reliability");

    await expectNoA11yViolations(view.container);
  });
});
