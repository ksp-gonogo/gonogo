import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ScreenProvider } from "@ksp-gonogo/core";
import { SettingKind, SettingsPersistenceState } from "@ksp-gonogo/sitrep-sdk";
import { setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { initSoundSettings, isSoundEnabled } from "../sound/soundSettings";
import { ConsoleSettingsFromHost } from "./consoleSettings";
import { SettingsService } from "./SettingsService";

const TOPIC = "settings.gonogo";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

function consoleRow(name: string, value: boolean) {
  const text = value ? "True" : "False";
  return {
    path: `CONSOLE/${name}`,
    owner: "gonogo",
    kind: SettingKind.Bool,
    label: name,
    description: "",
    value: text,
    default: "False",
  };
}

function model(rows: ReturnType<typeof consoleRow>[]) {
  return {
    rows,
    modSettings: [],
    persistence: {
      state: SettingsPersistenceState.Saved,
      path: "GameData/Gonogo/PluginData/gonogo.cfg",
      savedAtUt: null,
      reason: null,
    },
    undeclared: [],
  };
}

const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts) unmount();
  unmounts.length = 0;
});

function mount(service: SettingsService) {
  const fixture = setupStreamFixture({ carriedChannels: [TOPIC] });
  const view = render(
    <ScreenProvider value="main">
      <fixture.Provider>
        <ConsoleSettingsFromHost service={service} />
      </fixture.Provider>
    </ScreenProvider>,
  );
  unmounts.push(view.unmount);
  return fixture;
}

async function publish(
  fixture: ReturnType<typeof setupStreamFixture>,
  payload: unknown,
) {
  await waitFor(() => expect(fixture.transport.isSubscribed(TOPIC)).toBe(true));
  act(() => fixture.emit(TOPIC, payload));
}

describe("ConsoleSettingsFromHost", () => {
  it("replaces a screen's stored copy with the host's value, and never sends the copy to the host", async () => {
    const service = new SettingsService(memoryStorage());
    service.set("sound.enabled", false);
    service.set("mission.historyEnabled", false);

    const fixture = mount(service);
    await publish(
      fixture,
      model([
        consoleRow("sound.enabled", true),
        consoleRow("mission.historyEnabled", true),
      ]),
    );

    await waitFor(() => {
      expect(service.get("sound.enabled", false)).toBe(true);
      expect(service.get("mission.historyEnabled", false)).toBe(true);
    });
    expect(fixture.transport.sentCommands).toHaveLength(0);
  });

  it("follows every value the host reports, not only the first", async () => {
    const service = new SettingsService(memoryStorage());
    const fixture = mount(service);

    await publish(fixture, model([consoleRow("sound.enabled", false)]));
    await waitFor(() => expect(service.get("sound.enabled", true)).toBe(false));

    act(() => fixture.emit(TOPIC, model([consoleRow("sound.enabled", true)])));
    await waitFor(() => expect(service.get("sound.enabled", false)).toBe(true));
  });

  it("copies only the mod's console rows", async () => {
    const service = new SettingsService(memoryStorage());
    const fixture = mount(service);

    await publish(
      fixture,
      model([
        { ...consoleRow("sound.enabled", false), path: "SIGNAL_DELAY/enabled" },
        { ...consoleRow("sound.enabled", false), owner: "example" },
        consoleRow("mission.historyEnabled", false),
      ]),
    );
    await waitFor(() =>
      expect(service.get("mission.historyEnabled", true)).toBe(false),
    );

    expect(service.get<unknown>("sound.enabled", "unset")).toBe("unset");
    expect(service.get<unknown>("enabled", "unset")).toBe("unset");
  });
});

/**
 * Sound is gated by a module flag, primed once on the main screen and kept in
 * step by subscription. A flag read at boot and never again would keep the old
 * answer after the operator changed it, so it is driven through two changes.
 */
describe("the main screen's sound flag", () => {
  it("follows the host's setting through every change after it is primed", async () => {
    const service = new SettingsService(memoryStorage());
    unmounts.push(initSoundSettings(service));
    expect(isSoundEnabled()).toBe(true);

    const fixture = mount(service);
    await publish(fixture, model([consoleRow("sound.enabled", false)]));
    await waitFor(() => expect(isSoundEnabled()).toBe(false));

    act(() => fixture.emit(TOPIC, model([consoleRow("sound.enabled", true)])));
    await waitFor(() => expect(isSoundEnabled()).toBe(true));
  });
});

/**
 * Rendering either screen whole needs a live peer and a live mod, so their
 * wiring is read from source instead.
 */
function screenSource(file: string): string {
  return readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "screens",
      `${file}.tsx`,
    ),
    "utf8",
  );
}

describe("screen wiring", () => {
  it("copies the host's settings into the service the main screen primes its sound flag from", () => {
    const source = screenSource("MainScreen");
    expect(source).toContain("initSoundSettings(settingsService)");
    expect(source).toContain(
      "<ConsoleSettingsFromHost service={settingsService} />",
    );
  });

  it("copies the host's settings into the station's own service", () => {
    expect(screenSource("StationScreen")).toContain(
      "<ConsoleSettingsFromHost service={settingsService} />",
    );
  });
});
