import type { ComponentDefinition } from "@ksp-gonogo/core";
import { SettingsService } from "@ksp-gonogo/core";
import { TelemetryClient, TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_RATE_SETTING, syncDataRate } from "./dataRate";
import { fastTopicsOf, WidgetDataRateBridge } from "./WidgetDataRateBridge";

function def(
  rates: Pick<ComponentDefinition, "dataRates" | "dataRatesFromConfig">,
): ComponentDefinition {
  return {
    id: "rate-probe",
    name: "Rate probe",
    description: "",
    tags: [],
    component: () => null,
    ...rates,
  };
}

function seriesOf(config: Record<string, unknown>): string[] {
  const { series } = config;
  return Array.isArray(series)
    ? series.filter((entry): entry is string => typeof entry === "string")
    : [];
}

describe("fastTopicsOf", () => {
  it("puts a named Value's whole Topic at the fast tier, once", () => {
    expect(
      fastTopicsOf(
        def({
          dataRates: {
            fast: ["vessel.flight.altitude", "vessel.flight", "vessel.landing"],
          },
        }),
        {},
      ),
    ).toEqual(["vessel.flight", "vessel.landing"]);
  });

  it("adds the Values the tile's settings name", () => {
    expect(
      fastTopicsOf(
        def({
          dataRatesFromConfig: (config) => ({ fast: seriesOf(config) }),
        }),
        { series: ["vessel.orbit"] },
      ),
    ).toEqual(["vessel.orbit"]);
  });
});

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    key: () => null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  } as Storage;
}

describe("WidgetDataRateBridge", () => {
  let stop: (() => void) | undefined;
  afterEach(() => {
    stop?.();
    stop = undefined;
  });
  const choose = (choice: "normal" | "faster") => {
    const settings = new SettingsService(memoryStorage());
    settings.set(DATA_RATE_SETTING, choice);
    stop = syncDataRate(settings);
    return settings;
  };

  it("claims nothing under Normal", () => {
    choose("normal");
    const client = new TelemetryClient(new StubTransport());
    render(
      <TelemetryProvider client={client}>
        <WidgetDataRateBridge
          def={def({ dataRates: { fast: ["vessel.flight"] } })}
          config={{}}
        />
      </TelemetryProvider>,
    );
    expect(client.claimedTier("vessel.flight")).toBe("base");
  });

  it("follows a switch while the widget stays mounted", () => {
    const settings = choose("faster");
    const client = new TelemetryClient(new StubTransport());
    render(
      <TelemetryProvider client={client}>
        <WidgetDataRateBridge
          def={def({ dataRates: { fast: ["vessel.flight"] } })}
          config={{}}
        />
      </TelemetryProvider>,
    );
    expect(client.claimedTier("vessel.flight")).toBe("fast");

    act(() => settings.set(DATA_RATE_SETTING, "normal"));
    expect(client.claimedTier("vessel.flight")).toBe("base");

    act(() => settings.set(DATA_RATE_SETTING, "faster"));
    expect(client.claimedTier("vessel.flight")).toBe("fast");
  });

  it("holds the widget's fast Topics while it is mounted and follows its settings", () => {
    choose("faster");
    const client = new TelemetryClient(new StubTransport());
    const graph = def({
      dataRatesFromConfig: (config) => ({ fast: seriesOf(config) }),
    });

    const { rerender, unmount } = render(
      <TelemetryProvider client={client}>
        <WidgetDataRateBridge
          def={graph}
          config={{ series: ["vessel.flight"] }}
        />
      </TelemetryProvider>,
    );
    expect(client.claimedTier("vessel.flight")).toBe("fast");

    rerender(
      <TelemetryProvider client={client}>
        <WidgetDataRateBridge
          def={graph}
          config={{ series: ["vessel.orbit"] }}
        />
      </TelemetryProvider>,
    );
    expect(client.claimedTier("vessel.flight")).toBe("base");
    expect(client.claimedTier("vessel.orbit")).toBe("fast");

    unmount();
    expect(client.claimedTier("vessel.orbit")).toBe("base");
  });
});
