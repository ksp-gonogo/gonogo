import {
  act,
  render,
  setupStreamFixture,
  waitFor,
  within,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
// Importing the real module runs its module-load registerComponent(...).
import { ShipSystemsComponent } from "./index";

/**
 * A resource the PROFILE declares and the CRAFT has no tank for.
 *
 * `ResourceRow.fraction` is declared `number | null` and says what null means:
 * the vessel carries no tank for that resource. The profile belongs to the
 * INSTALL, not to the craft, so a probe flying three of the twelve resources a
 * profile declares is the ordinary case rather than an edge one. Every meter
 * for a resource with no tank was drawn as a bar sitting at zero, which says
 * the tank is empty rather than that there is no tank, and the pinned "Power"
 * footer is the one readout on this widget an operator acts on immediately.
 *
 * The habitat block next door was already fixed for exactly this and tested for
 * it (`index.test.tsx`'s "habitat readings that never arrived"); the resource,
 * wear and power meters were left behind by that pass.
 *
 * <b>Its own FILE, not another describe in `index.test.tsx`.</b> The timeline
 * store outlives one `setupStreamFixture`, so a `vessel.resources` sample an
 * earlier test wrote at that file's pinned UT wins over the partial-tank one
 * emitted here: written as a describe, both assertions below passed against the
 * full-tank fixture and went on passing with the coercion restored. Vitest
 * isolates per file, which the shared store makes load-bearing rather than
 * incidental.
 */

const CARRIED = [
  "kerbalism.profile",
  "kerbalism.lifesupport",
  "vessel.resources",
  "vessel.crew",
  "kerbalism.spaceweather",
];

/** Three supplies, so a craft can be missing one and still render a board. */
const PROFILE = {
  name: "Test Profile",
  resources: {
    Water: {
      flowMode: "ALL_VESSEL",
      flowModeOrdinal: 1,
      displayName: "Water",
      isSupply: true,
      lowThreshold: 0.15,
    },
    ElectricCharge: {
      flowMode: "ALL_VESSEL_BALANCE",
      flowModeOrdinal: 4,
      displayName: "Electric Charge",
      isSupply: true,
      lowThreshold: 0.15,
    },
    Oxygen: {
      flowMode: "ALL_VESSEL",
      flowModeOrdinal: 1,
      displayName: "Oxygen",
      isSupply: true,
    },
  },
  rules: [],
  processes: [],
};

const LIFE_SUPPORT = {
  rates: { Water: -0.0005 },
  habitat: { pressure: 0.9, poisoning: 0.05, comfort: 0.6, livingSpace: 0.7 },
  processes: [],
  greenhouses: [],
};

const CREW = {
  count: 2,
  capacity: 4,
  crew: [{ name: "Jebediah Kerman", trait: "Pilot" }],
  meta: { source: "test", quality: 1 },
};

const renderedTrees: Array<() => void> = [];

/**
 * `useProcessor` reads straight off the `TimelineStore` and does not itself
 * subscribe, while `StubTransport.emit` honours the wire's subscription gate.
 * A dummy subscribe per topic flips that gate the way a companion widget
 * reading the same topic would in production. Same reasoning, at length, in
 * `index.test.tsx`.
 */
function mount(resources: Record<string, unknown>) {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
  });
  for (const topic of CARRIED) fixture.subscribe(topic);
  const { container, unmount } = render(
    <fixture.Provider>
      <ShipSystemsComponent config={{}} id="ship-systems-no-tank" />
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  act(() => {
    fixture.emit("kerbalism.profile", PROFILE);
    fixture.emit("kerbalism.lifesupport", LIFE_SUPPORT);
    fixture.emit("vessel.resources", {
      resources,
      meta: { source: "test", quality: 1 },
    });
    fixture.emit("vessel.crew", CREW);
  });
  // Scoped to the container: the queries a bare `render()` returns are bound to
  // document.body, where another test's tree can answer them.
  return within(container);
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

/**
 * ONE case, one mount, deliberately. The store carries the last sample per
 * topic for the whole file whatever view time a fixture pins, so a second mount
 * here reads the first one's tanks; both meters this is about can be seen on a
 * single craft, so there is nothing to gain from splitting them.
 */
describe("ShipSystems: a resource the craft carries no tank for", () => {
  it("names the row, draws no meter for it, and pins no power bar", async () => {
    const panel = mount({
      // Water is the only tank aboard. Oxygen and ElectricCharge are in the
      // profile and not on the craft.
      Water: { current: 50, max: 500, active: true },
    });

    // Water HAS a tank, so wait for its meter first: asserting the others'
    // absence before anything has rendered would pass on an empty tree.
    await waitFor(() =>
      expect(panel.getByRole("meter", { name: "Water" })).toBeInTheDocument(),
    );
    // A meter asserts a fill fraction and an `aria-valuenow` to go with it,
    // and there is no fraction to assert.
    expect(panel.queryByRole("meter", { name: "Oxygen" })).toBeNull();
    // The pinned footer readout, and the one an operator acts on soonest.
    expect(panel.queryByRole("meter", { name: "Power" })).toBeNull();
    // Both rows still name themselves, so the operator can see what is missing
    // rather than the resource silently vanishing from the ledger.
    expect(panel.getByText("Oxygen")).toBeInTheDocument();
    expect(panel.getByText("Electric Charge")).toBeInTheDocument();
  });
});
