import type { ConfigField, DataSource } from "@ksp-gonogo/core";
import {
  clearRegistry,
  registerDataSource,
  ScreenProvider,
} from "@ksp-gonogo/core";
import { SerialDeviceProvider, SerialDeviceService } from "@ksp-gonogo/serial";
import { SettingKind, SettingsPersistenceState } from "@ksp-gonogo/sitrep-sdk";
import { setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModSettingsSection } from "../settings/ModSettingsSection";
import { SettingsProvider } from "../settings/SettingsContext";
import { SettingsModal } from "../settings/SettingsModal";
import { SettingsService } from "../settings/SettingsService";
import { FirstRunSetup } from "./FirstRunSetup";

/*
 * The first-run setup surfaces settings that are in Settings, to highlight
 * them; it never offers one that Settings does not show. This holds the two
 * against one roster: every setting label the setup draws must also be drawn
 * somewhere in the Settings window.
 */

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

function entry(
  id: string,
  name: string | null,
  fields: Record<string, unknown>,
) {
  return {
    id,
    name,
    version: "1.0.0",
    available: true,
    reason: null,
    modSettings: false,
    bundled: false,
    health: { state: 0, detail: null },
    ...fields,
  };
}

const ROSTER = {
  uplinks: [
    entry("comms", null, {
      modSettings: true,
      setupModSettings: true,
      bundled: true,
    }),
    entry("fleet", "Fleet", { bundled: true }),
    entry("survival", "Survival", {
      modSettings: true,
      setupModSettings: true,
    }),
  ],
};

function fileRow(path: string, owner: string, label: string, tags: string[]) {
  return {
    path,
    owner,
    kind: SettingKind.Bool,
    label,
    description: "",
    value: "True",
    default: "True",
    tags,
  };
}

const FILE = {
  rows: [
    fileRow("CONSOLE/sound.enabled", "gonogo", "Sound effects", ["setup"]),
    fileRow(
      "CONSOLE/mission.historyEnabled",
      "gonogo",
      "Record mission history",
      [],
    ),
    fileRow("Uplinks/fleet/showLanded", "fleet", "Show landed vessels", [
      "setup",
    ]),
    fileRow("Uplinks/survival/warnOnWear", "survival", "Warn on wear", [
      "setup",
    ]),
  ],
  persistence: {
    state: SettingsPersistenceState.Saved,
    path: "gonogo.cfg",
    savedAtUt: 1,
    reason: null,
  },
  undeclared: [],
};

function modRow(id: string, label: string, tags: string[]) {
  return {
    id,
    label,
    description: "",
    kind: SettingKind.Bool,
    unit: null,
    group: "",
    setIn: "Difficulty settings",
    writable: true,
    value: "True",
    unavailable: null,
    tags,
    lockedBy: null,
    lockReason: null,
  };
}

function modSettings(uplink: string, settings: unknown[]) {
  return { uplink, failure: null, settings };
}

const TOPICS: Record<string, unknown> = {
  "system.uplinks": ROSTER,
  "settings.gonogo": FILE,
  "settings.comms": modSettings("comms", [
    modRow("delayEnabled", "Signal delay", []),
    modRow(
      "telemetryRequiresCharge",
      "Vessel telemetry requires vessel charge",
      ["setup"],
    ),
  ]),
  "settings.survival": modSettings("survival", [
    modRow("mtbfFailures", "Failures from wear", ["setup"]),
  ]),
  "settings.planted": modSettings("planted", [
    modRow("plantedRow", "A setting only the setup draws", ["setup"]),
  ]),
};

/** Every setting label the fixture carries, the planted one included. */
const LABELS = [
  "Sound effects",
  "Record mission history",
  "Show landed vessels",
  "Warn on wear",
  "Signal delay",
  "Vessel telemetry requires vessel charge",
  "Failures from wear",
  "A setting only the setup draws",
];

/** The labels drawn now, out of {@link LABELS}. */
function shownLabels(): Set<string> {
  return new Set(
    LABELS.filter(
      (label) => screen.queryAllByText(label, { exact: true }).length > 0,
    ),
  );
}

/** Mounts a tree over a stream carrying every topic, publishing each topic again until the tree has read what it subscribes to. */
async function mount(tree: ReactNode, settled: () => boolean) {
  registerDataSource(connected);
  const fixture = setupStreamFixture();
  render(
    <ScreenProvider value="main">
      <SettingsProvider service={new SettingsService(memoryStorage())}>
        <SerialDeviceProvider
          service={new SerialDeviceService({ screenKey: "setup-subset-test" })}
        >
          <fixture.Provider>{tree}</fixture.Provider>
        </SerialDeviceProvider>
      </SettingsProvider>
    </ScreenProvider>,
  );
  const publish = () =>
    act(() => {
      for (const [topic, payload] of Object.entries(TOPICS)) {
        if (fixture.transport.isSubscribed(topic)) fixture.emit(topic, payload);
      }
    });
  await waitFor(() => {
    publish();
    expect(settled()).toBe(true);
  });
  // A section mounts off the roster and only then subscribes to its own topic, so publish until what is drawn stops changing.
  let last = "";
  let steady = 0;
  for (let round = 0; round < 50 && steady < 3; round++) {
    publish();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const now = [...shownLabels()].join("|");
    steady = now === last ? steady + 1 : 0;
    last = now;
  }
  return publish;
}

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, String(v));
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  } as Storage;
}

/** Every label the first-run setup draws, across the Delay and Recommended steps, plus whatever `extra` draws beside them. */
async function setupLabels(extra?: ReactNode): Promise<Set<string>> {
  const shown = new Set<string>();
  for (const step of ["delay", "recommended"] as const) {
    await mount(
      <>
        <FirstRunSetup initialStep={step} />
        {extra}
      </>,
      () =>
        step === "delay"
          ? screen.queryByText("Signal delay", { exact: true }) !== null
          : screen.queryByText("Failures from wear", { exact: true }) !== null,
    );
    for (const label of shownLabels()) shown.add(label);
    cleanup();
  }
  return shown;
}

/** Every label the Settings window draws, on the Gonogo tab and on every Uplink's page. */
async function settingsLabels(): Promise<Set<string>> {
  const shown = new Set<string>();
  const publish = await mount(
    <SettingsModal initialTabId="gonogo" />,
    () => screen.queryByText("Sound effects", { exact: true }) !== null,
  );
  for (const label of shownLabels()) shown.add(label);
  fireEvent.click(screen.getByRole("tab", { name: "Uplinks" }));
  for (const page of ["Survival"]) {
    fireEvent.click(await screen.findByRole("tab", { name: page }));
    await waitFor(() => {
      publish();
      expect(
        screen.queryByText("Failures from wear", { exact: true }),
      ).not.toBeNull();
    });
    for (const label of shownLabels()) shown.add(label);
  }
  cleanup();
  return shown;
}

function outsideSettings(setup: Set<string>, settings: Set<string>): string[] {
  return [...setup].filter((label) => !settings.has(label));
}

beforeEach(() => {
  clearRegistry();
});

afterEach(() => {
  cleanup();
});

describe("the first-run setup offers only settings that Settings shows", () => {
  it("draws no setting that the Settings window does not", async () => {
    const settings = await settingsLabels();
    const setup = await setupLabels();

    expect(
      outsideSettings(setup, settings).map(
        (label) =>
          `${label} is offered in the first-run setup but appears nowhere in Settings`,
      ),
    ).toEqual([]);

    // Seen, so the comparison is not of two empty sets: every tagged row reaches the setup, and Settings shows the bundled Uplinks' rows.
    expect([...setup].sort()).toEqual(
      [
        "Failures from wear",
        "Show landed vessels",
        "Signal delay",
        "Sound effects",
        "Vessel telemetry requires vessel charge",
        "Warn on wear",
      ].sort(),
    );
    expect(settings.has("Show landed vessels")).toBe(true);
    expect(settings.has("Signal delay")).toBe(true);
  });

  it("sees a setting drawn in the setup without a place in Settings", async () => {
    const settings = await settingsLabels();
    // Planted: drawn beside the setup straight from its Uplink, bypassing the places Settings draws.
    const setup = await setupLabels(
      <ModSettingsSection uplinkId="planted" name="Planted" tag="setup" />,
    );

    expect(outsideSettings(setup, settings)).toEqual([
      "A setting only the setup draws",
    ]);
  });
});
