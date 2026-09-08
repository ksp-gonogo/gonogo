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
 * A ProcessController the mod could see but could not READ.
 *
 * `running` and `broken` are both `bool?` on the contract and the mod stopped
 * flattening them, so a scrubber whose module fields moved arrives with neither
 * flag. The row's state came off a truthiness ladder that had no third rung, so
 * it rendered "idle": a plant that is fitted, intact and switched off, which an
 * operator fixes by reaching for a toggle rather than by looking closer. The
 * header fraction counted it among the not-running too.
 *
 * Its own FILE for the same reason `noTank.test.tsx` is: the timeline store
 * outlives one `setupStreamFixture`, so a `kerbalism.lifesupport` sample from
 * another file's describe wins over the one emitted here.
 */

const CARRIED = [
  "kerbalism.profile",
  "kerbalism.lifesupport",
  "vessel.resources",
  "vessel.crew",
  "kerbalism.spaceweather",
];

const PROFILE = {
  name: "Test Profile",
  resources: {
    Oxygen: {
      flowMode: "ALL_VESSEL",
      flowModeOrdinal: 1,
      displayName: "Oxygen",
      isSupply: true,
      lowThreshold: 0.15,
    },
  },
  rules: [],
  processes: [],
};

const LIFE_SUPPORT = {
  rates: { Oxygen: -0.0005 },
  habitat: { pressure: 0.9, poisoning: 0.05, comfort: 0.6, livingSpace: 0.7 },
  processes: [
    // Read, and running.
    { resource: "_Scrubber", title: "Scrubber", running: true, broken: false },
    // Seen on the vessel; neither flag came back.
    { resource: "_WaterRecycler", title: "Water Recycler" },
  ],
  greenhouses: [],
};

const CREW = {
  count: 2,
  capacity: 4,
  crew: [{ name: "Jebediah Kerman", trait: "Pilot" }],
  meta: { source: "test", quality: 1 },
};

const renderedTrees: Array<() => void> = [];

function mount() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
  });
  for (const topic of CARRIED) fixture.subscribe(topic);
  const { container, unmount } = render(
    <fixture.Provider>
      <ShipSystemsComponent config={{}} id="ship-systems-unread-process" />
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  act(() => {
    fixture.emit("kerbalism.profile", PROFILE);
    fixture.emit("kerbalism.lifesupport", LIFE_SUPPORT);
    fixture.emit("vessel.resources", {
      resources: { Oxygen: { current: 50, max: 500, active: true } },
      meta: { source: "test", quality: 1 },
    });
    fixture.emit("vessel.crew", CREW);
  });
  return within(container);
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

describe("ShipSystems: a process whose run state never arrived", () => {
  it("says the row is unread rather than idle, and keeps it out of the running fraction", async () => {
    const panel = mount();

    // The read process first: asserting the other's label before anything has
    // rendered would pass on an empty tree.
    await waitFor(() =>
      expect(panel.getByText("Scrubber")).toBeInTheDocument(),
    );
    expect(panel.getByText("Water Recycler")).toBeInTheDocument();
    expect(panel.getByText("unknown")).toBeInTheDocument();
    // "idle" was the answer this row used to give.
    expect(panel.queryByText("idle")).toBeNull();
    // Counted apart from the running fraction, which would otherwise report
    // the unread plant as one of the switched-off ones.
    expect(panel.getByText("1 running · 1 unread")).toBeInTheDocument();
  });
});
