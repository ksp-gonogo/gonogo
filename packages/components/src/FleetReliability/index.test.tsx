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
  const fixture = setupStreamFixture({ carriedChannels: CARRIED });
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

/**
 * Waits for the view clock's frame to carry an emitted sample into the render.
 *
 * The fixture applies a sample on the next animation frame, not on the emit, so
 * a query made straight afterwards reads the widget as it was BEFORE the record
 * arrived. Learned the hard way in ThermalStatus, where an assertion about an
 * absence passed on the pre-emit render whatever the widget did.
 */
async function settleFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

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

    await settleFrame();
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

    await settleFrame();
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
