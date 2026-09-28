import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { FleetReliabilityUpdates } from "./index";

/**
 * The reliability augment's content rows: it consumes the one elected
 * reliability.* pair and renders only on the active vessel's row. The absence
 * states are `coverage-matrix.test.tsx`'s subject.
 */

const ACTIVE_IDENTITY = {
  vesselId: "v-active",
  name: "Active One",
  vesselType: 0,
  situation: 3,
};

const MODELED = { source: "testflight", coverage: "modeled" };

const SCENE = [
  {
    partId: "101:0",
    title: "Reaction Wheel",
    condition: "failed-critical",
    conditionDetail: "busted",
  },
  {
    partId: "102:0",
    title: "Antenna",
    condition: "service-due",
    conditionDetail: "needs service",
    budgets: [
      {
        id: "service",
        label: "service",
        kind: "schedule",
        consumed: 1.4,
        usedSeconds: 302400,
        limitSeconds: 216000,
      },
    ],
  },
  {
    partId: "103:0",
    title: "RD-180",
    condition: "nominal",
    survival: 0.82,
    survivalHorizonSeconds: 255,
    budgets: [
      {
        id: "burn.continuous",
        label: "continuous rated burn",
        kind: "risk-ramp",
        consumed: 0.91,
        usedSeconds: 232,
        limitSeconds: 255,
      },
      {
        id: "burn.cumulative",
        label: "cumulative rated burn",
        kind: "risk-ramp",
        consumed: 0.1,
        usedSeconds: 26,
        limitSeconds: 255,
      },
    ],
  },
  { partId: "104:0", title: "Battery", condition: "nominal" },
];

function renderAugment(vesselId: string, compact = false) {
  const fixture = setupStreamFixture({
    suspendFrames: true,
  });
  const utils = render(
    <fixture.Provider>
      <FleetReliabilityUpdates
        vesselId={vesselId}
        vesselName="Row"
        body="Kerbin"
        compact={compact}
      />
    </fixture.Provider>,
  );
  return { fixture, ...utils };
}

function emit(
  fixture: ReturnType<typeof setupStreamFixture>,
  summary: unknown,
  parts: unknown,
): void {
  act(() => {
    fixture.emit("vessel.identity", ACTIVE_IDENTITY);
    fixture.emit("reliability.summary", summary);
    fixture.emit("reliability.parts", parts);
  });
}

const ENGINEER = {
  name: "Bill Kerman",
  trait: "Engineer",
  experienceLevel: 2,
  carrying: [{ name: "evaRepairKit", title: "EVA Repair Kit", quantity: 2 }],
};

const PILOT = {
  name: "Jebediah Kerman",
  trait: "Pilot",
  experienceLevel: 5,
  carrying: [{ name: "evaRepairKit", title: "EVA Repair Kit", quantity: 9 }],
};

describe("the repair control offers only crew the provider would accept", () => {
  /** The crew list shows only kerbals meeting the provider's own stated requirement, so a known refusal is never offered. */
  it("hides a kerbal of the wrong trait, however much they are carrying", async () => {
    const { fixture } = renderAugment("v-active");
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("vessel.crew", {
        count: 2,
        capacity: 3,
        crew: [PILOT, ENGINEER],
      });
      fixture.emit("reliability.summary", {
        source: "kerbalism",
        coverage: "modeled",
      });
      fixture.emit("reliability.parts", [
        {
          partId: "1:0",
          title: "Reaction Wheel",
          condition: "failed",
          repairTrait: "Engineer",
          repairLevel: 2,
        },
      ]);
    });

    await act(async () => {
      screen.getByRole("button", { name: /repair/i }).click();
    });

    expect(screen.getByText(/Bill Kerman/)).toBeInTheDocument();
    // Nine kits and five levels do not make a pilot an engineer.
    expect(screen.queryByText(/Jebediah Kerman/)).toBeNull();
    await act(async () => {});
  });

  it("names the requirement when nobody aboard meets it", async () => {
    const { fixture } = renderAugment("v-active");
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("vessel.crew", { count: 1, capacity: 3, crew: [PILOT] });
      fixture.emit("reliability.summary", {
        source: "kerbalism",
        coverage: "modeled",
      });
      fixture.emit("reliability.parts", [
        {
          partId: "1:0",
          title: "Reaction Wheel",
          condition: "failed",
          repairTrait: "Engineer",
          repairLevel: 2,
        },
      ]);
    });

    await act(async () => {
      screen.getByRole("button", { name: /repair/i }).click();
    });

    // The reason is ON the disabled control: a refusal costs the same round trip a success does.
    const confirm = screen.getByRole("button", { name: /repair/i });
    expect(confirm).toBeDisabled();
    expect(confirm.getAttribute("title")).toMatch(/Engineer level 2/);
    // Said in text as well: a disabled button takes no focus and shows no tooltip on touch.
    expect(screen.getByText(/Engineer level 2/)).toBeVisible();
    await act(async () => {});
  });

  it("offers no repair for a part it could not address", async () => {
    const { fixture } = renderAugment("v-active");
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("vessel.crew", { count: 1, capacity: 3, crew: [ENGINEER] });
      fixture.emit("reliability.summary", MODELED);
      fixture.emit("reliability.parts", [
        { title: "Reaction Wheel", condition: "failed" },
      ]);
    });

    expect(await screen.findByText("Reaction Wheel")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /repair/i })).toBeNull();
    await act(async () => {});
  });
});

/**
 * What a repair consumes is the elected provider's statement on
 * `reliability.parts`, rendered and never derived. An ABSENT cost and a ZERO
 * cost are different claims. The verb comes from the condition, never the cost.
 */
describe("what a repair costs is the provider's statement", () => {
  /** As TestFlight actually reports one: a plain failure, no trait, no cost. */
  const TESTFLIGHT_FAILURE = [
    {
      partId: "101:0",
      title: "RD-180",
      condition: "failed",
      conditionDetail: "turbopump failure",
    },
  ];

  /** Same part as Kerbalism reports it: critical, trait-gated, and a cost of THREE kits, a number the widget could not derive. */
  const KERBALISM_CRITICAL = [
    {
      partId: "101:0",
      title: "Reaction Wheel",
      condition: "failed-critical",
      conditionDetail: "busted",
      repairTrait: "Engineer",
      repairLevel: 2,
      repairCost: [{ name: "evaRepairKit", quantity: 3 }],
    },
  ];

  const EMPTY_HANDED = {
    name: "Jebediah Kerman",
    trait: "Pilot",
    experienceLevel: 5,
    carrying: [],
  };

  it("asks for no kits, and blocks nothing, when the provider states no cost", async () => {
    const { fixture } = renderAugment("v-active");
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("vessel.crew", {
        count: 1,
        capacity: 3,
        crew: [EMPTY_HANDED],
      });
      fixture.emit("vessel.inventory", { stores: [] });
      fixture.emit("reliability.summary", MODELED);
      fixture.emit("reliability.parts", TESTFLIGHT_FAILURE);
    });

    await act(async () => {
      screen.getByRole("button", { name: /repair/i }).click();
    });

    // No ledger, because there is nothing to ledger: not "0 kits".
    expect(screen.queryByText(/kit/i)).toBeNull();
    // The command is offered: the provider decides whether a repair with no stated cost succeeds.
    const confirm = screen.getByRole("button", { name: /repair/i });
    expect(confirm).toBeEnabled();
    await act(async () => {});
  });

  it("renders the item and count the provider DID state", async () => {
    const { fixture } = renderAugment("v-active");
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("vessel.crew", {
        count: 1,
        capacity: 3,
        crew: [ENGINEER],
      });
      fixture.emit("vessel.inventory", { stores: [] });
      fixture.emit("reliability.summary", {
        source: "kerbalism",
        coverage: "modeled",
      });
      fixture.emit("reliability.parts", KERBALISM_CRITICAL);
    });

    await act(async () => {
      screen.getByRole("button", { name: /repair/i }).click();
    });

    // The ledger names the item by its display title rather than assuming kits.
    expect(
      screen.getByText(/3 EVA Repair Kit · 2 carried · 0 aboard/),
    ).toBeVisible();
    // Refuses on the provider's number: two carried against three needed is short.
    const confirm = screen.getByRole("button", { name: /repair/i });
    expect(confirm).toBeDisabled();
    expect(confirm.getAttribute("title")).toMatch(/Needs 3/);
    await act(async () => {});
  });
});

describe("FleetReliabilityUpdates augment", () => {
  it("lists the parts worth a row, and leaves the untroubled ones off", async () => {
    const { fixture } = renderAugment("v-active");
    emit(fixture, MODELED, SCENE);

    expect(await screen.findByText("Reaction Wheel")).toBeInTheDocument();
    expect(screen.getByText("Antenna")).toBeInTheDocument();
    expect(screen.getByText("RD-180")).toBeInTheDocument();
    // Nominal, no numbers at all: nothing to say about it.
    expect(screen.queryByText("Battery")).not.toBeInTheDocument();
    expect(screen.getByText("3 at risk")).toBeInTheDocument();
  });

  it("says what is wrong with each part in the provider's own words", async () => {
    const { fixture } = renderAugment("v-active");
    emit(fixture, MODELED, SCENE);

    expect(await screen.findByText("critical failure")).toBeInTheDocument();
    expect(screen.getByText(/busted/)).toBeInTheDocument();
    expect(screen.getByText("service due")).toBeInTheDocument();
  });

  /** The two burn ratings diverge tenfold under RO, so the scope is IN the sentence. */
  it("names the scope of the burn budget it is quoting", async () => {
    const { fixture } = renderAugment("v-active");
    emit(fixture, MODELED, SCENE);

    // Through `Unit`, so 255 s reads "4min 15s" on the duration ladder.
    const row = await screen.findByText(/continuous rated burn left/);
    expect(row).toHaveTextContent("23s of 4min 15s continuous rated burn left");
    // And the OTHER scope's numbers are not what is on screen.
    expect(row).not.toHaveTextContent("cumulative");
  });

  /** Never a future countdown beside a "service due" badge: a part found worn is due NOW whatever its clock says. */
  it("never renders a future countdown beside a service-due badge", async () => {
    const { fixture } = renderAugment("v-active");
    emit(fixture, MODELED, [
      {
        partId: "1:0",
        title: "Antenna",
        condition: "service-due",
        budgets: [
          {
            id: "service",
            label: "service",
            kind: "schedule",
            consumed: 0.4,
            usedSeconds: 86400,
            limitSeconds: 216000,
          },
        ],
      },
    ]);

    expect(await screen.findByText("service due")).toBeInTheDocument();
    expect(screen.queryByText(/due in/)).not.toBeInTheDocument();
  });

  it("puts the horizon on screen whenever it quotes a survival probability", async () => {
    const { fixture } = renderAugment("v-active");
    emit(fixture, MODELED, [
      {
        partId: "1:0",
        title: "RD-180",
        condition: "nominal",
        survival: 0.82,
        survivalHorizonSeconds: 255,
      },
    ]);

    // The horizon is IN the sentence ("percent" is the unit symbol's accessible name, which textContent picks up).
    const row = await screen.findByText(/to survive/);
    expect(row).toHaveTextContent(
      "82 % percent to survive 4min 15s of operation",
    );
  });

  /** An unheard-of condition string still renders, never an empty line. */
  it("renders a condition it does not recognise rather than dropping the row", async () => {
    const { fixture } = renderAugment("v-active");
    emit(fixture, MODELED, [
      {
        partId: "1:0",
        title: "Turbopump",
        condition: "degraded-by-some-future-mod",
        conditionDetail: "spalling",
      },
    ]);

    expect(await screen.findByText("Turbopump")).toBeInTheDocument();
    expect(screen.getByText("unreadable")).toBeInTheDocument();
    expect(screen.getByText(/spalling/)).toBeInTheDocument();
  });

  it("renders nothing on a NON-active vessel's row", () => {
    const { fixture, container } = renderAugment("v-other");
    emit(fixture, MODELED, SCENE);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the modelled craft has nothing worth reporting", () => {
    const { fixture, container } = renderAugment("v-active");
    emit(fixture, { source: "kerbalism", coverage: "modeled" }, [
      { partId: "1:0", title: "FL-T400 Tank", condition: "nominal" },
    ]);
    expect(container).toBeEmptyDOMElement();
  });

  /** A narrow roster sheds the words and keeps the alarm. */
  it("keeps the badge and drops the detail rows when the row is compact", async () => {
    const { fixture } = renderAugment("v-active", true);
    emit(fixture, MODELED, SCENE);

    expect(await screen.findByText("3 at risk")).toBeInTheDocument();
    expect(screen.queryByText("Reaction Wheel")).not.toBeInTheDocument();
    expect(screen.queryByText("critical failure")).not.toBeInTheDocument();
  });

  it("has no axe violations on the active row", async () => {
    const { fixture, container } = renderAugment("v-active");
    emit(fixture, MODELED, SCENE);
    await screen.findByText("Reaction Wheel");
    await expectNoA11yViolations(container);
  });
});

/**
 * A refusal must never reach the operator on the confirmed path. These drive
 * the real wire envelope through the real client, since a test building its own
 * envelope cannot see a refusal dressed as success.
 */
describe("a refused repair is refused on screen", () => {
  const BROKEN = [
    {
      partId: "101:0",
      title: "RD-180",
      condition: "failed",
      conditionDetail: "turbopump failure",
    },
  ];

  function arm(fixture: ReturnType<typeof setupStreamFixture>): void {
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("vessel.crew", { count: 1, capacity: 3, crew: [ENGINEER] });
      fixture.emit("vessel.inventory", { stores: [] });
      fixture.emit("reliability.summary", MODELED);
      fixture.emit("reliability.parts", BROKEN);
    });
  }

  /** Opens the row's repair control, then arms and confirms it: a single click only arms. */
  async function press(): Promise<HTMLElement> {
    await act(async () => {
      screen.getByRole("button", { name: /repair/i }).click();
    });
    const confirm = screen.getByRole("button", { name: /repair/i });
    await act(async () => {
      confirm.click();
    });
    await act(async () => {
      confirm.click();
    });
    await act(async () => {});
    return confirm;
  }

  it("lands in the refused phase, not back at rest", async () => {
    const { fixture } = renderAugment("v-active");
    // The root, with the finer refusal beside it.
    fixture.transport.setCommandHandler(() => ({
      success: false,
      errorCode: "capabilityMismatch",
      reason: "repair.crewNotQualified",
      payload: null,
    }));
    arm(fixture);

    const confirm = await press();

    expect(confirm).toHaveAttribute("data-command-phase", "refused");
    await act(async () => {});
  });

  it("settles at rest only when the repair actually happened", async () => {
    const { fixture } = renderAugment("v-active");
    fixture.transport.setCommandHandler(() => ({
      success: true,
      payload: { repaired: true, kitsUsed: 1, kitsFrom: "carried" },
    }));
    arm(fixture);

    const confirm = await press();

    expect(confirm).toHaveAttribute("data-command-phase", "idle");
    await act(async () => {});
  });

  /** `success: true` beside `repaired: false` reads as a confirmed repair, which is why the mod must never send it. */
  it("would have shown a refusal as a success on the old envelope", async () => {
    const { fixture } = renderAugment("v-active");
    fixture.transport.setCommandHandler(() => ({
      success: true,
      payload: { repaired: false, kitsUsed: 0, kitsFrom: null },
    }));
    arm(fixture);

    const confirm = await press();

    expect(confirm).toHaveAttribute("data-command-phase", "idle");
    await act(async () => {});
  });
});
