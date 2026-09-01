import {
  act,
  render,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import {
  expectNoA11yViolations,
  visibleText,
  WidgetHost,
} from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { RP1_BUILD_START_COMMAND } from "./Buildable";
import { VehicleAssembly } from "./index";

const TOPICS = [
  "rp1.available",
  "rp1.warehouse",
  "rp1.buildQueue",
  "rp1.buildable",
  "rp1.complexes",
  "rp1.pads",
  "rp1.operations",
  "career.status",
  RP1_BUILD_START_COMMAND,
];

const CAREER = {
  economy: { funds: 289_848, reputation: 40, science: 12 },
};

const COMPLEXES = [
  {
    engineers: 18,
    isOperational: true,
    kscName: "Cape",
    lcId: "lc-1",
    lcType: "Pad",
    massMax: 180,
    massMin: 6,
    maxEngineers: 60,
    name: "LC-1",
  },
];

/**
 * One saved craft as the wire carries it, whole and buildable at LC-1.
 *
 * <para>Every key present, including the empty part arrays: an absent array and
 * an empty one mean different things to this widget, and a fixture that left
 * them out would exercise only the absent branch.</para>
 */
function craft(overrides: Record<string, unknown> = {}) {
  return {
    complexes: [
      {
        eligible: true,
        kscName: "Cape",
        lcId: "lc-1",
        name: "LC-1",
        refusals: [],
      },
    ],
    cost: 40_000,
    craftFile: "Atlas LV-3B",
    facility: 1,
    lockedParts: [],
    mass: 120,
    missingParts: [],
    partCount: 42,
    shipName: "Atlas LV-3B",
    unpurchasedParts: [],
    ...overrides,
  };
}

function mount() {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  const view = render(
    <fixture.Provider>
      <WidgetHost widgetId="rp1-vehicle-assembly">
        <VehicleAssembly />
      </WidgetHost>
    </fixture.Provider>,
  );
  return { fixture, view };
}

/**
 * RP-1's presence gate, and the wait for what it mounts to reach the wire.
 * Waited on the SUBSCRIPTION rather than on anything drawn, for the reason the
 * widget's own suite gives at length: the sections draw nothing until their
 * lists arrive, so there is no mark on screen that says the subscription is
 * open.
 */
async function rp1IsPresent(fixture: ReturnType<typeof setupStreamFixture>) {
  act(() => {
    fixture.emit("rp1.available", true);
  });
  await waitFor(() => {
    expect(fixture.transport.isSubscribed("rp1.buildable")).toBe(true);
  });
}

/** A career with one saved craft and one complex that would take it. */
async function withOneSavedCraft(overrides: Record<string, unknown> = {}) {
  const mounted = mount();
  await rp1IsPresent(mounted.fixture);
  act(() => {
    mounted.fixture.emit("career.status", CAREER);
    mounted.fixture.emit("rp1.complexes", COMPLEXES);
    mounted.fixture.emit("rp1.warehouse", []);
    mounted.fixture.emit("rp1.buildQueue", []);
    mounted.fixture.emit("rp1.buildable", [craft(overrides)]);
  });
  return mounted;
}

describe("starting a build from a saved craft", () => {
  it("offers a build control for a craft the space centre has never held", async () => {
    /*
     * The whole point of the section: an empty career could watch RP-1 and
     * could not start anything in it, because the only build command copied a
     * vehicle that already existed.
     */
    await withOneSavedCraft();

    expect(await screen.findByText("START A BUILD")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", {
        name: /Start building Atlas LV-3B at LC-1/i,
      }),
    ).toBeInTheDocument();
  });

  it("dispatches the craft file, the editor and the complex that was pressed", async () => {
    const { fixture } = await withOneSavedCraft();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", {
        name: /Start building Atlas LV-3B at LC-1/i,
      }),
    );
    // Arms before it commits, like every other spend control in this widget.
    await user.click(
      await screen.findByRole("button", {
        name: /Confirm starting Atlas LV-3B/i,
      }),
    );

    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === RP1_BUILD_START_COMMAND,
      );
      /*
       * All three on the wire, and the complex among them even though only one
       * could have been meant: the mod REQUIRES it, so the dispatch records
       * which complex was chosen rather than leaving it to be inferred.
       */
      expect(sent?.args).toEqual({
        craftFile: "Atlas LV-3B",
        facility: 1,
        lcId: "lc-1",
      });
    });
  });

  it("names the price on the confirm wording, beside the balance the widget already draws", async () => {
    // The repo's funds rule: a control that spends is never visible without a
    // balance visible in the same widget. The host draws the balance; this
    // proves the two are on screen together.
    await withOneSavedCraft();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", {
        name: /Start building Atlas LV-3B at LC-1/i,
      }),
    );

    const text = visibleText(document.body);
    expect(text).toContain("289,848");
    expect(text).toMatch(/Spend ~/);
  });

  it("draws no control and gives the reason when no complex would take the craft", async () => {
    await withOneSavedCraft({
      complexes: [
        {
          eligible: false,
          kscName: "Cape",
          lcId: "lc-1",
          name: "LC-1",
          refusals: ["too heavy for the complex at 2,900.0 t, limit 180.0 t"],
        },
      ],
    });

    expect(
      await screen.findByText(/too heavy for the complex/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Start building/i }),
    ).not.toBeInTheDocument();
  });

  it("gives a complex's reason even when another complex would take the craft", async () => {
    // A list that only showed the complexes saying yes would leave an operator
    // pressing the one button they have and never learning why there is one.
    await withOneSavedCraft({
      complexes: [
        {
          eligible: true,
          kscName: "Cape",
          lcId: "lc-1",
          name: "LC-1",
          refusals: [],
        },
        {
          eligible: false,
          kscName: "Cape",
          lcId: "lc-2",
          name: "LC-2",
          refusals: ["too large for the complex on its y axis"],
        },
      ],
    });

    expect(
      await screen.findByRole("button", {
        name: /Start building Atlas LV-3B at LC-1/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/LC-2 at Cape: too large/)).toBeInTheDocument();
  });

  it("refuses a craft whose parts are researched but not bought, and says where to buy them", async () => {
    /*
     * RP-1's own window offers to spend the funds through a popup, which a
     * command dispatched from another machine has nobody to answer, so the
     * remedy is named instead of taken.
     */
    await withOneSavedCraft({ unpurchasedParts: ["RO-Vanguard-X405"] });

    expect(
      await screen.findByText(/researched but not bought, unlock at R&D first/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Start building/i }),
    ).not.toBeInTheDocument();
  });

  it("separates a part this install lacks from a part that is merely unresearched", async () => {
    const { fixture } = await withOneSavedCraft({
      missingParts: ["RO-Atlas-LR89"],
    });

    expect(
      await screen.findByText(/this install does not have RO-Atlas-LR89/),
    ).toBeInTheDocument();

    act(() => {
      fixture.emit("rp1.buildable", [
        craft({ lockedParts: ["RO-Agena-8096"], missingParts: [] }),
      ]);
    });

    expect(
      await screen.findByText(/not researched yet: RO-Agena-8096/),
    ).toBeInTheDocument();
  });

  it("says the career has no craft rather than drawing nothing", async () => {
    // An empty list and a channel that has not answered look identical if this
    // is left out, and only one of them is something an operator can act on.
    const mounted = mount();
    await rp1IsPresent(mounted.fixture);
    act(() => {
      mounted.fixture.emit("career.status", CAREER);
      mounted.fixture.emit("rp1.complexes", COMPLEXES);
      mounted.fixture.emit("rp1.buildable", []);
    });

    expect(await screen.findByText(/No craft saved/)).toBeInTheDocument();
  });

  it("says it is waiting when RP-1 is present and the craft listing has not landed", async () => {
    const mounted = mount();
    await rp1IsPresent(mounted.fixture);
    act(() => {
      mounted.fixture.emit("career.status", CAREER);
      mounted.fixture.emit("rp1.complexes", COMPLEXES);
    });

    expect(
      await screen.findByText(/waiting for the craft listing/),
    ).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { view } = await withOneSavedCraft();
    await screen.findByText("START A BUILD");

    await expectNoA11yViolations(view.container);
  });
});
