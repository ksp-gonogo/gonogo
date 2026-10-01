import { modSettingDep, SettingKind } from "@ksp-gonogo/sitrep-sdk";
import {
  clearContributions,
  registerContribution,
} from "@ksp-gonogo/sitrep-sdk/spine";
import {
  act,
  render,
  screen,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { useContributionsBySlotId } from "./contributionsRead";
import { ContributionsProvider } from "./contributionsRuntime";
import { WidgetMetaContext } from "./WidgetMetaContext";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface ModSettingsRegistry {
    settingsdepprobe: {
      readonly trainingEnabled: boolean;
      readonly budget: number;
    };
  }
  interface ContributionRegistry {
    "settings-dep-probe.rows": { entry: { label: string } };
  }
}

const SLOT = "settings-dep-probe.rows";

function Probe() {
  const entries = useContributionsBySlotId(SLOT);
  return <output>{JSON.stringify(entries)}</output>;
}

function row(id: string, kind: SettingKind, value: string | null) {
  return {
    id,
    label: id,
    description: "",
    kind,
    group: "",
    setIn: "",
    writable: false,
    value,
  };
}

function mount() {
  const stream = setupStreamFixture();
  render(
    <stream.Provider>
      <WidgetMetaContext.Provider
        value={{ componentId: "settings-dep-probe", contributionSlots: [SLOT] }}
      >
        <ContributionsProvider>
          <Probe />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </stream.Provider>,
  );
  return stream;
}

// beforeEach, never afterEach: clearing while the previous test's tree is still mounted notifies SlotAggregator's subscription outside act()
beforeEach(() => {
  clearContributions();
});

describe("a contribution's typed mod-setting dep", () => {
  it("receives the setting parsed to the type its Uplink declared, and undefined until the mod lists it", () => {
    registerContribution({
      id: "settings-dep-probe",
      contributes: SLOT,
      deps: [
        modSettingDep("settingsdepprobe", "trainingEnabled"),
        modSettingDep("settingsdepprobe", "budget"),
      ],
      compute: (topics) => {
        const enabled: boolean | undefined =
          topics["settings.settingsdepprobe.trainingEnabled"];
        const budget: number | undefined =
          topics["settings.settingsdepprobe.budget"];
        return [{ label: `${String(enabled)}/${String(budget)}` }];
      },
    });
    const stream = mount();
    expect(screen.getByRole("status")).toHaveTextContent("undefined/undefined");

    act(() => {
      stream.emit("settings.settingsdepprobe", {
        uplink: "settingsdepprobe",
        settings: [
          row("trainingEnabled", SettingKind.Bool, "True"),
          row("budget", SettingKind.Number, "12.5"),
        ],
        meta: {},
      });
      stream.store.beginFrame();
    });
    expect(screen.getByRole("status")).toHaveTextContent("true/12.5");
  });
});

describe("what a mod-setting dep refuses to compile", () => {
  it("rejects an undeclared setting, an undeclared Uplink and an untyped topic", () => {
    // @ts-expect-error the Uplink declares no setting called "nope"
    expect(() => modSettingDep("settingsdepprobe", "nope")).not.toThrow();
    // @ts-expect-error no Uplink called "nobody" declares settings
    expect(() => modSettingDep("nobody", "trainingEnabled")).not.toThrow();

    expect(() =>
      registerContribution({
        id: "settings-dep-bad-key",
        contributes: SLOT,
        // @ts-expect-error a hand-built dep naming an undeclared setting is not a ContributionDep
        deps: [{ modSetting: { uplink: "settingsdepprobe", key: "nope" } }],
        compute: () => [],
      }),
    ).not.toThrow();
    expect(() =>
      registerContribution({
        id: "settings-dep-bad-topic",
        contributes: SLOT,
        // @ts-expect-error an arbitrary string is not a Topic
        deps: ["settings.settingsdepprobe"],
        compute: () => [],
      }),
    ).not.toThrow();
    registerContribution({
      id: "settings-dep-bad-read",
      contributes: SLOT,
      deps: [modSettingDep("settingsdepprobe", "budget")],
      compute: (topics) => {
        // @ts-expect-error a setting not named in deps cannot be read
        const unnamed = topics["settings.settingsdepprobe.trainingEnabled"];
        // @ts-expect-error the setting is a number, not a boolean
        const wrong: boolean | undefined =
          topics["settings.settingsdepprobe.budget"];
        return [{ label: String(unnamed) + String(wrong) }];
      },
    });
  });
});
