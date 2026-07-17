import { AugmentSlot, clearRegistry } from "@ksp-gonogo/core";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { Quality } from "@ksp-gonogo/sitrep-sdk";

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";
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

// The row composes ui-kit's `Inline`/`Row`, which read `theme.space`. The
// project render supplies the theme, so no local wrapper is needed.
function renderSlot(ui: ReactElement) {
  return render(ui);
}

describe("SCANsat science augment — science-officer.badges slot", () => {
  beforeEach(() => {
    clearRegistry();
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
      transport.emit("scansat.science", [SCAN_ENTRY], {
        quality: Quality.Loaded,
        source: "scansat",
      });
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

    // Announce availability first so the presence-gated augment mounts and its
    // `scansat.science` subscription goes live — `StubTransport.emit` is
    // subscription-gated and drops a frame nothing has subscribed to yet, and
    // the augment isn't rendered (so doesn't subscribe) until `available` is
    // true. The provider commits frames on a rAF, so wait for the subscription
    // to actually appear before emitting the science frame.
    act(() => {
      transport.emit("scansat.available", true, {
        quality: Quality.Loaded,
        source: "scansat",
      });
    });
    await waitFor(() =>
      expect(transport.isSubscribed("scansat.science")).toBe(true),
    );
    act(() => {
      transport.emit("scansat.science", [SCAN_ENTRY], {
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
      transport.emit("scansat.science", [], {
        quality: Quality.Loaded,
        source: "scansat",
      });
    });

    expect(screen.queryByText(/SCANSAT/)).toBeNull();
  });

  it("stays absent when the scansat domain is unavailable but other augments would render", () => {
    // No TelemetryProvider at all — the app-realistic case of a KSP install
    // with no SCANsat mod present: `scansat.available` never arrives, so
    // the presence gate's `available` stays permanently `undefined` (and with
    // no store mounted, the `scansat.science` read never resolves either).
    renderSlot(
      <AugmentSlot
        name="science-officer.badges"
        props={{ instruments: null, dataAmount: 0 }}
      />,
    );

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

    // Availability first (mounts the augment + its science subscription), then
    // the science frame — see the sibling test's note on subscription-gating
    // and the rAF frame commit.
    act(() => {
      transport.emit("scansat.available", true, {
        quality: Quality.Loaded,
        source: "scansat",
      });
    });
    await waitFor(() =>
      expect(transport.isSubscribed("scansat.science")).toBe(true),
    );
    act(() => {
      transport.emit("scansat.science", [SCAN_ENTRY], {
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
