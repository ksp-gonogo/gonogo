import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { FleetReliabilityUpdates } from "./index";

/**
 * The reliability augment consumes the ONE elected reliability.* topic pair
 * (source-agnostic: TestFlight or Kerbalism or a vanilla None fallback feed the
 * same shape) and is ACTIVE-VESSEL scoped (reliability.* carries no vesselId),
 * so it renders only on the row whose vesselId matches vessel.identity.vesselId
 * and nothing on every other row.
 *
 * The absence states get their own file (`coverage-matrix.test.tsx`), which
 * asserts they are all DIFFERENT from each other rather than each being null.
 * This file is about the content rows.
 */
const CARRIED = [
  "reliability.summary",
  "reliability.parts",
  "vessel.identity",
  "vessel.crew",
  "vessel.inventory",
  "vessel.repair",
];

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
    carriedChannels: CARRIED,
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
  /**
   * Asserted here rather than looked at, because a static render cannot show
   * it: the crew list only exists once the operator has opened the control.
   *
   * The requirement is the PROVIDER's own, already elevated by it for a
   * critical failure, so filtering on it is showing that judgement rather than
   * pre-empting it. The point is to stop the console offering a choice it
   * already knows will be refused, which under delay costs a round trip to find
   * out.
   */
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

    /*
     * The reason has to be ON the disabled control, not discovered by
     * dispatching: a refusal costs the same round trip a success does.
     */
    const confirm = screen.getByRole("button", { name: /repair/i });
    expect(confirm).toBeDisabled();
    expect(confirm.getAttribute("title")).toMatch(/Engineer level 2/);
    await act(async () => {});
  });
});

/**
 * What a repair consumes is the elected provider's statement, carried on
 * `reliability.parts`. This widget renders it and never derives it.
 *
 * <p>It used to derive it. A `kitsNeeded(condition)` here returned 2 for
 * "failed-critical" and 1 for "failed", which is Kerbalism's arithmetic read
 * off its `Repair()`, and it applied on every install. TestFlight emits
 * "failed" and models no consumable at all (see `TestFlightReliabilityMap`,
 * which never emits "failed-critical" and states neither repair trait nor
 * level), so on a TestFlight install the row asked for a repair kit the mod
 * never needs and DISABLED the command when none was aboard: a repairable
 * failure the operator could not act on, for want of an item irrelevant to
 * it.</p>
 *
 * <p>An ABSENT cost and a ZERO cost are different claims, which is why the two
 * cases below are separate tests rather than one. The verb comes from the
 * condition, never from the cost, so a serviceable part still reads "Service"
 * whatever its provider charges.</p>
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

  /**
   * Same part as Kerbalism reports it: critical, trait-gated, and a cost.
   *
   * THREE kits, deliberately not the two Kerbalism's own critical rule charges,
   * because a fixture that agrees with the arithmetic this change deleted
   * cannot tell the two apart: the old `kitsNeeded("failed-critical")` returned
   * 2 and would have rendered an identical row. Only a number the widget could
   * not have derived proves it is reading the provider's.
   */
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
    /*
     * And the command is offered. TestFlight's own `Repair()` decides whether
     * this succeeds (the contract requires a refusal rather than a throw from
     * a backend that models none), so refusing it HERE for want of a kit is
     * this widget substituting its own judgement for the provider's.
     */
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

    /*
     * The ITEM is named too, by its display title where something aboard
     * carries one, so the ledger says what is being spent rather than assuming
     * every backend spends kits.
     */
    expect(
      screen.getByText(/3 EVA Repair Kit · 2 carried · 0 aboard/),
    ).toBeVisible();
    /*
     * And it still refuses on the provider's number, not on a derived one: two
     * carried against three needed is short, and the reason says so.
     */
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

  /**
   * The two burn ratings are independent and diverge tenfold under RO, so the
   * scope has to be IN the sentence: "23 s left" with no scope could be read as
   * the cumulative figure, which here is more than eight times larger.
   */
  it("names the scope of the burn budget it is quoting", async () => {
    const { fixture } = renderAugment("v-active");
    emit(fixture, MODELED, SCENE);

    // Both figures go through `Unit`, so 255 s reads on the duration ladder as
    // "4min 15s" exactly as every other interval on the dashboard does.
    const row = await screen.findByText(/continuous rated burn left/);
    expect(row).toHaveTextContent("23s of 4min 15s continuous rated burn left");
    // And the OTHER scope's numbers are not what is on screen.
    expect(row).not.toHaveTextContent("cumulative");
  });

  /**
   * A service-due badge beside "service due in 40 d" contradicts itself, and it
   * would be the normal render: Kerbalism's NeedsMaintenance() has a second
   * source unrelated to the clock, so a part inspected today and found worn is
   * due NOW with its maintenance date far away.
   */
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

    /*
     * The horizon is IN the sentence, never implied: exp(-rate*t) is
     * uninterpretable without t, and two parts' fractions are not comparable
     * unless both horizons are on screen. ("percent" is the unit symbol's
     * accessible name, which textContent picks up alongside the glyph.)
     */
    const row = await screen.findByText(/to survive/);
    expect(row).toHaveTextContent(
      "82 % percent to survive 4min 15s of operation",
    );
  });

  /**
   * A condition string this build has never heard of is still a condition, and
   * an open selection with a closed render would pick the part and then draw an
   * empty line for it.
   */
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

  /**
   * The roster is too narrow for detail lines, so the augment sheds the WORDS
   * and keeps the alarm. The slot used to be dropped wholesale below six
   * columns, which is the normal width of a portrait station panel.
   */
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
 * A refusal must not reach the operator on the confirmed path.
 *
 * <p>`vessel.repair` returned every outcome through
 * `CommandResult<RepairOutcome>.Ok(...)`, and `Ok` sets `Success` true
 * unconditionally, so the mod answered a refused repair with a SUCCESS
 * envelope carrying `repaired: false` in a payload nothing reads. The promise
 * resolved, `CommandButton` ran `settle("idle", null)`, and a repair that never
 * happened was byte-identical on screen to one that did.</p>
 *
 * <p>These drive the REAL wire shape through the real client, rather than
 * asserting on the mapping in isolation: the defect was entirely in the
 * envelope, and a test that built its own envelope would have passed
 * throughout.</p>
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

  /**
   * Open the row's repair control, then ARM and CONFIRM it. The two presses are
   * the control's own guard against a stray click spending a round trip, not
   * ceremony: a single click only arms, and a test that stopped there would
   * assert on a command it never sent.
   */
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
    /*
     * Exactly what RepairRefusal.ResultFor now puts on the wire for a crew that
     * does not qualify: a failure code, with the finer token still on the
     * payload.
     */
    fixture.transport.setCommandHandler(() => ({
      success: false,
      errorCode: 16, // CommandErrorCode.CapabilityMismatch
      payload: { repaired: false, refusal: "crew-not-qualified" },
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
      errorCode: 0,
      payload: { repaired: true, kitsUsed: 1, kitsFrom: "carried" },
    }));
    arm(fixture);

    const confirm = await press();

    expect(confirm).toHaveAttribute("data-command-phase", "idle");
    await act(async () => {});
  });

  /**
   * The arm that shipped: `success: true` beside `repaired: false`. Nothing
   * downstream reads the payload, so this is the exact envelope that made a
   * refusal indistinguishable from a success, and it must not be what the mod
   * sends. Pinned here so a regression to `Ok(outcome)` shows up as a widget
   * that confirms a repair which did not happen.
   */
  it("would have shown a refusal as a success on the old envelope", async () => {
    const { fixture } = renderAugment("v-active");
    fixture.transport.setCommandHandler(() => ({
      success: true,
      errorCode: 0,
      payload: { repaired: false, refusal: "crew-not-qualified" },
    }));
    arm(fixture);

    const confirm = await press();

    expect(confirm).toHaveAttribute("data-command-phase", "idle");
    await act(async () => {});
  });
});
