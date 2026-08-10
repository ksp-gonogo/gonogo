import { act, fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { resourceColor } from "@ksp-gonogo/ui-kit";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { setupStreamFixture } from "../test/setupStreamFixture";
// Importing the real module runs its module-load registerComponent(...).
import { fmtAmt, ShipSystemsComponent } from "./index";

const CARRIED = [
  "kerbalism.profile",
  "kerbalism.lifesupport",
  "vessel.resources",
  "vessel.crew",
  "kerbalism.spaceweather",
];

// A minimal-but-real profile: three Supplies (Water/ElectricCharge/Oxygen), a
// crew "drinking" rule, a Water Recycler process that drinks ElectricCharge
// and WasteWater to produce Water, and a scrubber process that drains a wear
// pseudo-resource. Bare numbers throughout: `StubTransport.emit` wraps them
// into `Value`s the same way a real wire frame arrives (see that method's own
// doc comment), and `mag()` reads either shape regardless.
const PROFILE = {
  name: "Test Profile",
  resources: {
    Water: {
      flowMode: "ALL_VESSEL",
      displayName: "Water",
      isSupply: true,
      lowThreshold: 0.15,
    },
    ElectricCharge: {
      flowMode: "ALL_VESSEL_BALANCE",
      displayName: "Electric Charge",
      isSupply: true,
      lowThreshold: 0.15,
    },
    Oxygen: { flowMode: "ALL_VESSEL", displayName: "Oxygen", isSupply: true },
    WasteWater: {
      flowMode: "ALL_VESSEL",
      displayName: "Waste Water",
      isSupply: false,
    },
    _NonRegenScrubber: {
      flowMode: "",
      displayName: "Scrubber Cartridge",
      isSupply: false,
    },
  },
  rules: [
    {
      name: "drinking",
      input: "Water",
      output: "WasteWater",
      ratePerSecond: 0.00001,
    },
  ],
  processes: [
    {
      name: "Water Recycler",
      modifiers: ["_WaterRecycler"],
      inputs: { WasteWater: 0.0002, ElectricCharge: 0.01 },
      outputs: { Water: 0.00018 },
    },
    {
      name: "CO2 Scrubber",
      modifiers: ["_Scrubber"],
      inputs: { _NonRegenScrubber: 0.00002 },
      outputs: {},
    },
  ],
};

// ElectricCharge is the ROOT CAUSE (nothing in the profile produces it, and
// it's short); Water is DOWNSTREAM (its one producer, the Water Recycler,
// also drinks the short ElectricCharge). Both drain fast enough to carry a
// real time-to-empty; Oxygen is healthy and steady, the sorting contrast.
const LIFE_SUPPORT = {
  rates: {
    Water: -0.0005,
    ElectricCharge: -0.05,
  },
  habitat: {
    pressure: 0.9,
    poisoning: 0.05,
    comfort: 0.6,
    livingSpace: 0.7,
  },
  processes: [
    {
      resource: "_WaterRecycler",
      title: "Water Recycler",
      capacity: 1,
      running: true,
      broken: false,
    },
    {
      resource: "_Scrubber",
      title: "CO2 Scrubber",
      capacity: 1,
      running: true,
      broken: false,
    },
  ],
  greenhouses: [],
};

const RESOURCES = {
  resources: {
    Water: { current: 50, max: 500, active: true },
    ElectricCharge: { current: 20, max: 400, active: true },
    Oxygen: { current: 380, max: 400, active: true },
    WasteWater: { current: 10, max: 200, active: true },
    _NonRegenScrubber: { current: 30, max: 100, active: true },
  },
  meta: { source: "test", quality: 1 },
};

const CREW = {
  count: 2,
  capacity: 4,
  crew: [
    { name: "Jebediah Kerman", trait: "Pilot" },
    { name: "Bill Kerman", trait: "Engineer" },
  ],
  meta: { source: "test", quality: 1 },
};

const renderedTrees: Array<() => void> = [];

function newFixture() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
  });
  primeSubscriptions(fixture);
  return fixture;
}

function renderWidget(fixture: ReturnType<typeof newFixture>) {
  const result = render(
    <fixture.Provider>
      <ShipSystemsComponent config={{}} id="ship-systems-under-test" />
    </fixture.Provider>,
  );
  renderedTrees.push(result.unmount);
  return result;
}

/**
 * `useProcessor`'s dependency resolution reads straight off the
 * `TimelineStore` (`store.sample`), it does not itself call
 * `client.subscribe` for its raw Topic deps the way `useTelemetry`/
 * `useStream` do. `StubTransport.emit` mirrors the real wire protocol's
 * subscription gate (nothing streams for a topic nobody has subscribed to,
 * see `default-carried-topics.ts`'s "Promotion here is an allowlist, not a
 * subscription" doc comment), so a bare `emit` here would silently no-op.
 * A dummy `client.subscribe` per topic flips that gate exactly the way a
 * companion widget reading the same topic would in production, this is a
 * TEST concern only: see this file's own report for the production-side
 * open question it surfaces (nothing else on a real dashboard currently
 * subscribes to the brand-new `kerbalism.profile` topic either).
 */
function primeSubscriptions(fixture: ReturnType<typeof newFixture>) {
  for (const topic of CARRIED) fixture.client.subscribe(topic, () => {});
}

function emitAll(fixture: ReturnType<typeof newFixture>) {
  act(() => {
    fixture.emit("kerbalism.profile", PROFILE);
    fixture.emit("kerbalism.lifesupport", LIFE_SUPPORT);
    fixture.emit("vessel.resources", RESOURCES);
    fixture.emit("vessel.crew", CREW);
  });
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

describe("ShipSystemsComponent", () => {
  it("pins the root cause above the shortage it explains, in Supplies order", async () => {
    const fixture = newFixture();
    renderWidget(fixture);
    emitAll(fixture);

    // Limiting-factors banner names the actual root, not the symptom.
    // Renders twice by design: once in the panel-level banner, once as the
    // per-row footnote on Water's own row (the same duplicated-diagnosis
    // convention the banner has always used).
    await screen.findByText("Limiting factors");
    expect(
      screen.getAllByText(/Water is being limited by Electric Charge/).length,
    ).toBeGreaterThan(0);

    // Supplies render root (Electric Charge) above the shortage it explains
    // (Water), Oxygen (healthy, no role) sorts last: `summarise`'s own order,
    // never re-sorted by the widget.
    const meters = await screen.findAllByRole("meter");
    const labels = meters.map((m) => m.getAttribute("aria-label"));
    expect(labels.slice(0, 3)).toEqual(["Electric Charge", "Water", "Oxygen"]);
  });

  it("names the blocked resource as the subject and the blocker by its display name", async () => {
    const fixture = newFixture();
    renderWidget(fixture);
    emitAll(fixture);

    // Water is downstream of Electric Charge: the footnote reads subject
    // (Water, the row it sits on) is being limited by object (Electric
    // Charge, the blocker), by DISPLAY name (never the raw profile key
    // "ElectricCharge"), and the reverse never appears on Electric
    // Charge's own row. Also carries a time-to-empty prediction for the
    // SUBJECT resource (Water), not the blocker.
    await screen.findByText("Limiting factors");
    const messages = screen.getAllByText(
      /Water is being limited by Electric Charge\./,
    );
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(message.textContent).toMatch(/of Water left/);
    }
    expect(screen.queryByText(/ElectricCharge/)).toBeNull();
    expect(
      screen.queryByText(/Electric Charge is being limited by/),
    ).not.toBeInTheDocument();
  });

  it("shows a time-to-empty for a draining supply and 'steady' for a healthy one", async () => {
    const fixture = newFixture();
    renderWidget(fixture);
    emitAll(fixture);

    // "20 / 400" renders twice by design: once in the Supplies meter row,
    // once in the pinned Power footer (the same duplicated-readout
    // convention "always show the funds balance" uses elsewhere).
    const ecCaptions = await screen.findAllByText(/20 \/ 400/);
    expect(ecCaptions).toHaveLength(2);
    for (const caption of ecCaptions) {
      expect(caption.textContent).not.toContain("steady");
    }

    const oxygenCaption = await screen.findByText(/380 \/ 400/);
    expect(oxygenCaption.textContent).toContain("steady");
  });

  it("expands a resource row to reveal its rate ledger", async () => {
    const fixture = newFixture();
    renderWidget(fixture);
    emitAll(fixture);

    await screen.findByText("Water");
    fireEvent.click(
      screen.getByRole("button", { name: "Show rate breakdown for Water" }),
    );
    // "Water Recycler" now renders twice: once in the Processes list, once
    // as the newly-revealed ledger term.
    expect(screen.getAllByText("Water Recycler")).toHaveLength(2);
    expect(screen.getByText("Net (derived)")).toBeInTheDocument();
  });

  it("gives each ledger term a diverging bar, scaled against the largest term and coloured by sign", async () => {
    const fixture = newFixture();
    const { container } = renderWidget(fixture);
    emitAll(fixture);

    await screen.findByText("Water");
    fireEvent.click(
      screen.getByRole("button", { name: "Show rate breakdown for Water" }),
    );

    // Water's ledger has one term of each sign: the Water Recycler produces
    // Water (+0.00018/s once scaled by its capacity), the crew's "drinking"
    // rule consumes it (-0.00001/s * 2 crew = -0.00002/s). Sorted by
    // magnitude, the recycler (the larger term) sets the scale: its bar
    // reaches the track's own half-width mark (50%), the drinking rule's is
    // a fraction of that (0.00002 / 0.00018 * 50). The scaling math itself
    // is `@ksp-gonogo/ui-kit`'s `DivergingBar`, unit-tested there; this only
    // confirms ShipSystems wires each term's real rate and the ledger's own
    // scale into it.
    const bars = container.querySelectorAll('[data-testid="diverging-bar"]');
    expect(bars).toHaveLength(2);

    const [recyclerFill, drinkingFill] = [...bars].map(
      (bar) => bar.lastElementChild as HTMLElement,
    );
    expect(recyclerFill.style.width).toBe("50%");
    expect(drinkingFill.style.width).toBe(`${(0.00002 / 0.00018) * 50}%`);
  });

  it("has no axe violations", async () => {
    const fixture = newFixture();
    const { container } = renderWidget(fixture);
    emitAll(fixture);
    await screen.findByText("Limiting factors");

    expect(await axe(container)).toHaveNoViolations();
  });

  it("strips each resource row's Card with that resource's own colour from the shared map", async () => {
    const fixture = newFixture();
    const { container } = renderWidget(fixture);
    emitAll(fixture);

    await screen.findByText("Water");
    const waterCard = container.querySelector(
      '[data-testid="resource-card-Water"]',
    );
    const ecCard = container.querySelector(
      '[data-testid="resource-card-ElectricCharge"]',
    );
    expect(waterCard).toHaveStyle(
      `border-top: 3px solid ${resourceColor("Water")}`,
    );
    expect(ecCard).toHaveStyle(
      `border-top: 3px solid ${resourceColor("ElectricCharge")}`,
    );
    // Two different resources never collide on the same strip colour in
    // this profile's small set (a substring-collision would be a real bug).
    expect(resourceColor("Water")).not.toBe(resourceColor("ElectricCharge"));
  });
});

describe("ShipSystemsComponent: radiation", () => {
  it("renders nothing extra when no spaceweather frame has landed", async () => {
    const fixture = newFixture();
    renderWidget(fixture);
    emitAll(fixture);

    await screen.findByText("Limiting factors");
    expect(screen.queryByText("Ambient", { exact: false })).toBeNull();
  });

  it("shows the Radiation section once a spaceweather frame lands, and flags a greenhouse over its own tolerance", async () => {
    const fixture = newFixture();
    renderWidget(fixture);
    emitAll(fixture);
    act(() => {
      fixture.emit("kerbalism.lifesupport", {
        ...LIFE_SUPPORT,
        greenhouses: [
          {
            cropResource: "Food",
            foodRatePerSec: 0.0001,
            natural: 300,
            artificial: 0,
            active: true,
            issue: "",
            // 0.001 rad/s: below the ambient reading emitted below.
            radiationToleranceRadPerSec: 0.001,
          },
        ],
      });
      fixture.emit("kerbalism.spaceweather", {
        radiationRadPerSecond: 0.005,
        habitatRadiationRadPerSecond: 0.00005,
        outerBelt: true,
      });
    });

    // The ambient/shielded readouts and the belt badge from RadiationSection.
    await screen.findByText("Ambient", { exact: false });
    expect(screen.getByText("Shielded", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Outer belt")).toBeInTheDocument();

    // The greenhouse's own instantaneous threshold flag, fed the SAME
    // ambient reading via the life-support.sections augment slot.
    expect(screen.getByText("Radiation too high")).toBeInTheDocument();

    // The SAME condition also fires a panel-level badge, alongside (not
    // instead of) the per-row flag above: an operator scanning the header
    // should not have to scroll down to discover the greenhouse halted.
    expect(screen.getByText("System halted")).toBeInTheDocument();
  });

  it("renders the Radiation section ahead of Supplies, the widget's lead visual", async () => {
    const fixture = newFixture();
    const { container } = renderWidget(fixture);
    emitAll(fixture);
    act(() => {
      fixture.emit("kerbalism.spaceweather", {
        radiationRadPerSecond: 0.005,
        habitatRadiationRadPerSecond: 0.00005,
        magnetosphere: true,
      });
    });

    await screen.findByText("Ambient", { exact: false });
    const text = container.textContent ?? "";
    const radiationAt = text.indexOf("RADIATION");
    const suppliesAt = text.indexOf("SUPPLIES");
    expect(radiationAt).toBeGreaterThanOrEqual(0);
    expect(suppliesAt).toBeGreaterThan(radiationAt);
  });

  it("omits the panel-level halted badge when no greenhouse crosses its own tolerance", async () => {
    const fixture = newFixture();
    renderWidget(fixture);
    emitAll(fixture);
    act(() => {
      fixture.emit("kerbalism.lifesupport", {
        ...LIFE_SUPPORT,
        greenhouses: [
          {
            cropResource: "Food",
            foodRatePerSec: 0.0001,
            natural: 300,
            artificial: 0,
            active: true,
            issue: "",
            // Comfortably above the ambient reading emitted below: never
            // crosses its own tolerance.
            radiationToleranceRadPerSec: 0.05,
          },
        ],
      });
      fixture.emit("kerbalism.spaceweather", {
        radiationRadPerSecond: 0.005,
        habitatRadiationRadPerSecond: 0.00005,
        outerBelt: true,
      });
    });

    await screen.findByText("Ambient", { exact: false });
    expect(screen.queryByText("Radiation too high")).not.toBeInTheDocument();
    expect(screen.queryByText("System halted")).not.toBeInTheDocument();
  });

  it("has no axe violations with the radiation section and greenhouse flag showing", async () => {
    const fixture = newFixture();
    const { container } = renderWidget(fixture);
    emitAll(fixture);
    act(() => {
      fixture.emit("kerbalism.lifesupport", {
        ...LIFE_SUPPORT,
        greenhouses: [
          {
            cropResource: "Food",
            foodRatePerSec: 0.0001,
            natural: 300,
            artificial: 0,
            active: true,
            issue: "",
            radiationToleranceRadPerSec: 0.001,
          },
        ],
      });
      fixture.emit("kerbalism.spaceweather", {
        radiationRadPerSecond: 0.005,
        habitatRadiationRadPerSecond: 0.00005,
        innerBelt: true,
      });
    });
    await screen.findByText("Ambient", { exact: false });

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("fmtAmt", () => {
  it("never erases a small nonzero rate to a bare 0 (the ledger-drain bug)", () => {
    expect(fmtAmt(-0.01)).toBe("-0.01");
    expect(fmtAmt(0.02)).toBe("0.02");
  });

  it("still collapses genuine whole and near-whole numbers", () => {
    expect(fmtAmt(0)).toBe("0");
    expect(fmtAmt(3)).toBe("3");
    expect(fmtAmt(2.98)).toBe("3");
  });

  it("keeps precision for readable magnitudes and negatives", () => {
    expect(fmtAmt(-0.05)).toBe("-0.05");
    expect(fmtAmt(12.3)).toBe("12.3");
    expect(fmtAmt(-25)).toBe("-25");
  });
});
