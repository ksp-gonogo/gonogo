import type { DataKey } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { defaultDarkTheme } from "@ksp-gonogo/ui-kit";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { ThemeProvider } from "styled-components";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
// Importing the real module (not a throwaway test double) runs its
// module-load `registerAugment(...)` exactly once — the same way the app
// picks this augment up via the package's bare `import "./ScienceAugment"`.
// Unlike Scanning/slot.test.tsx and ScienceOfficer/slot.test.tsx (which
// probe the SLOT MECHANISM with disposable test augments), this suite
// verifies the actual production registration, so it deliberately never
// calls `clearAugments()` — that would wipe the one real registration this
// file exists to exercise, and re-importing an already-evaluated ES module
// is a no-op, so it would never come back.
import "./index";

const SCAN_ENTRY = {
  partId: "42",
  partTitle: "SCANsat SAR Altimetry Sensor",
  expId: "SCANsatAltimetryHiRes",
  deployed: false,
  hasData: true,
  rerunnable: true,
  inoperable: false,
};

// The row composes ui-kit's `Inline`/`Row`, which read `theme.space` —
// crashes without a theme in scope, same as ScienceOfficer's own
// `renderWithTheme` (`ScienceOfficer/testTheme.tsx`).
function renderSlot(ui: ReactElement) {
  return render(<ThemeProvider theme={defaultDarkTheme}>{ui}</ThemeProvider>);
}

describe("SCANsat science augment — science-officer.badges slot", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;

  beforeEach(async () => {
    clearRegistry();
    const keys: DataKey[] = [{ key: "scansat.science" }];
    source = new MockDataSource({ keys });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
  });

  afterEach(() => {
    cleanup();
    buffered.disconnect();
  });

  it("does not render while the scansat domain has not announced availability", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    renderSlot(
      <TelemetryProvider client={client}>
        <AugmentSlot
          name="science-officer.badges"
          props={{ instruments: null, dataAmount: 0 }}
        />
      </TelemetryProvider>,
    );
    act(() => {
      source.emit("scansat.science", [SCAN_ENTRY]);
    });

    expect(screen.queryByText(/SCANSAT/)).toBeNull();
  });

  it("renders SCANsat science experiments through the ui-kit row once the domain is live", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    renderSlot(
      <TelemetryProvider client={client}>
        <AugmentSlot
          name="science-officer.badges"
          props={{ instruments: null, dataAmount: 0 }}
        />
      </TelemetryProvider>,
    );

    act(() => {
      source.emit("scansat.science", [SCAN_ENTRY]);
      transport.emit("scansat.available", true, {
        quality: Quality.Loaded,
        source: "scansat",
      });
    });

    const toggle = await screen.findByRole("button", {
      name: /SCANsat science instruments \(1\)/i,
    });
    expect(toggle.textContent).toBe("SCANSAT 1");

    // Collapsed by default (brief's flagged layout tension — a full row list
    // can't just sit in the header's flex row) — the row is hidden until
    // the operator expands it.
    expect(screen.queryByText("SCANsat SAR Altimetry Sensor")).toBeNull();

    fireEvent.click(toggle);

    expect(
      screen.getByText("SCANsat SAR Altimetry Sensor"),
    ).toBeInTheDocument();
    // rerunnable=true, deployed=false, inoperable=false on every SCANsat
    // entry (mod-side ScanScience.Build hard-codes these) — only DATA shows.
    expect(screen.getByText("DATA")).toBeInTheDocument();
    expect(screen.queryByText("ONE-SHOT")).toBeNull();
    expect(screen.queryByText("DEPLOYED")).toBeNull();
    expect(screen.queryByText("INOPERABLE")).toBeNull();
  });

  it("renders nothing while scansat.science is null or empty, even with the domain live (silent-until-content)", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    renderSlot(
      <TelemetryProvider client={client}>
        <AugmentSlot
          name="science-officer.badges"
          props={{ instruments: null, dataAmount: 0 }}
        />
      </TelemetryProvider>,
    );
    act(() => {
      transport.emit("scansat.available", true, {
        quality: Quality.Loaded,
        source: "scansat",
      });
      source.emit("scansat.science", []);
    });

    expect(screen.queryByText(/SCANSAT/)).toBeNull();
  });

  it("stays absent when the scansat domain is unavailable but other augments would render", () => {
    // No TelemetryProvider at all — the app-realistic case of a KSP install
    // with no SCANsat mod present: `scansat.available` never arrives, so
    // the presence gate's `available` stays permanently `undefined`.
    renderSlot(
      <AugmentSlot
        name="science-officer.badges"
        props={{ instruments: null, dataAmount: 0 }}
      />,
    );
    act(() => {
      source.emit("scansat.science", [SCAN_ENTRY]);
    });

    expect(screen.queryByText(/SCANSAT/)).toBeNull();
  });

  it("passes an a11y smoke once expanded", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    const { container } = renderSlot(
      <TelemetryProvider client={client}>
        <AugmentSlot
          name="science-officer.badges"
          props={{ instruments: null, dataAmount: 0 }}
        />
      </TelemetryProvider>,
    );

    act(() => {
      source.emit("scansat.science", [SCAN_ENTRY]);
      transport.emit("scansat.available", true, {
        quality: Quality.Loaded,
        source: "scansat",
      });
    });

    const toggle = await screen.findByRole("button", {
      name: /SCANsat science instruments \(1\)/i,
    });
    fireEvent.click(toggle);
    await screen.findByText("SCANsat SAR Altimetry Sensor");

    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
