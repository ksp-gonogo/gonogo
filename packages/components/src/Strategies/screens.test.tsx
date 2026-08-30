import {
  ContributionsProvider,
  clearAugments,
  clearContributions,
  DashboardItemContext,
  registerAugment,
  registerContribution,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { StrategiesComponent } from "./index";
import { resolveScreens, type StrategiesScreenEntry } from "./screens";

/**
 * The Administration Building's tab strip: the contribution supplies the screen
 * LIST, an augment supplies a screen's BODY, and the widget owns the tablist.
 *
 * The two halves are tested from opposite ends. `resolveScreens` is pure and
 * gets the ordering, claiming and locking cases directly; the rendered tests go
 * through a real contribution registration and the real aggregation, because the
 * thing worth proving is that a screen registered the way an Uplink registers
 * one arrives on screen as a tab.
 */

const strategy = (
  id: string,
  department: string,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  title: id,
  description: "",
  departmentName: department,
  isActive: false,
  factor: 0,
  dateActivated: 0,
  requiredReputation: 0,
  initialCostFunds: 0,
  initialCostScience: 0,
  initialCostReputation: 0,
  effectiveCostReputation: 0,
  hasFactorSlider: false,
  factorSliderDefault: 0,
  factorSliderSteps: 1,
  canActivate: true,
  activateBlockedReason: "",
  canDeactivate: false,
  deactivateBlockedReason: "",
  effect: "",
  ...overrides,
});

const parsed = (
  id: string,
  department: string,
  overrides: Record<string, unknown> = {},
) => strategy(id, department, overrides) as never;

describe("resolveScreens", () => {
  it("draws no screens at all when nobody contributes one", () => {
    expect(resolveScreens([], [parsed("a", "Programs")])).toEqual([]);
  });

  it("orders by the stated order, then by contribution order", () => {
    const entries: StrategiesScreenEntry[] = [
      { id: "late", label: "Late", order: 20 },
      { id: "unordered-first", label: "Unordered first" },
      { id: "early", label: "Early", order: 10 },
      { id: "unordered-second", label: "Unordered second" },
    ];
    expect(resolveScreens(entries, []).map((s) => s.id)).toEqual([
      "early",
      "late",
      "unordered-first",
      "unordered-second",
    ]);
  });

  it("keeps the first of two screens claiming the same id", () => {
    const entries: StrategiesScreenEntry[] = [
      { id: "programs", label: "Programs" },
      { id: "programs", label: "Programmes" },
    ];
    const screens = resolveScreens(entries, []);
    expect(screens).toHaveLength(1);
    expect(screens[0].label).toBe("Programs");
  });

  it("lists only the departments a screen claims", () => {
    const screens = resolveScreens(
      [{ id: "programs", label: "Programs", departments: ["Programs"] }],
      [parsed("earlySounding", "Programs"), parsed("vonBraun", "Engineering")],
    );
    expect(screens[0].strategies.map((s) => s.id)).toEqual(["earlySounding"]);
  });

  it("sweeps unclaimed strategies into a trailing screen rather than hiding them", () => {
    const screens = resolveScreens(
      [{ id: "programs", label: "Programs", departments: ["Programs"] }],
      [
        parsed("earlySounding", "Programs"),
        parsed("vonBraun", "Engineering"),
        parsed("korolev", "Administration"),
      ],
    );
    expect(screens).toHaveLength(2);
    expect(screens[1].strategies.map((s) => s.id)).toEqual([
      "vonBraun",
      "korolev",
    ]);
  });

  it("drops the trailing screen once every department is claimed", () => {
    const screens = resolveScreens(
      [
        { id: "programs", label: "Programs", departments: ["Programs"] },
        { id: "leaders", label: "Leaders", departments: ["Engineering"] },
      ],
      [parsed("earlySounding", "Programs"), parsed("vonBraun", "Engineering")],
    );
    expect(screens.map((s) => s.id)).toEqual(["programs", "leaders"]);
  });

  it("carries a locked screen's reason through", () => {
    const screens = resolveScreens(
      [
        {
          id: "leaders",
          label: "Leaders",
          enabled: false,
          disabledReason:
            "Administrators will unlock once you complete the Karman Line contract.",
        },
      ],
      [],
    );
    expect(screens[0].lockedReason).toMatch(/Karman Line/);
  });

  it("still says a screen is locked when the contributor gave no reason", () => {
    const screens = resolveScreens(
      [{ id: "leaders", label: "Leaders", enabled: false }],
      [],
    );
    expect(screens[0].lockedReason).toBe("Not available yet");
  });
});

const META = {
  componentId: "strategies",
  contributionSlots: ["strategies.screens"] as const,
};

const renderedTrees: Array<() => void> = [];

function renderWidget() {
  const stream = setupStreamFixture({
    carriedChannels: ["career.status"],
    pinnedUt: 10,
    suspendFrames: true,
  });
  const result = render(
    <stream.Provider>
      <WidgetMetaContext.Provider value={META}>
        <ContributionsProvider>
          <DashboardItemContext.Provider value={{ instanceId: "s" }}>
            <StrategiesComponent config={{}} id="s" w={9} h={12} />
          </DashboardItemContext.Provider>
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </stream.Provider>,
  );
  renderedTrees.push(result.unmount);
  return { stream, ...result };
}

function emitCareer(
  stream: ReturnType<typeof setupStreamFixture>,
  all: unknown[],
) {
  stream.emit("career.status", {
    economy: { funds: 100000, reputation: 500, science: 200 },
    facilities: null,
    contracts: null,
    strategies: {
      active: all.filter((s) => (s as { isActive?: boolean }).isActive),
      all,
      activeCount: 0,
    },
    tech: null,
  });
}

const RP1_CAREER = [
  strategy("EarlySoundingRockets", "Programs", {
    title: "Early Sounding Rockets",
  }),
  strategy("KarmanLine", "Programs", { title: "Karman Line" }),
  strategy("leaderKorolev", "Engineering", { title: "Sergei Korolev" }),
  strategy("leaderLockedAdmin", "Administration", {
    title: "Reach the Karman Line First",
    canActivate: false,
    activateBlockedReason:
      "Administrators will unlock once you complete the Karman Line contract.",
  }),
];

describe("Strategies: the screen contribution slot", () => {
  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    clearContributions();
    clearAugments();
  });

  it("renders no tab strip while nobody contributes a screen", async () => {
    const { stream } = renderWidget();
    act(() => {
      emitCareer(stream, RP1_CAREER);
    });
    expect(await screen.findByText("Early Sounding Rockets")).toBeTruthy();
    // Every strategy is on screen, ungrouped, exactly as before the slot existed.
    expect(screen.getByText("Sergei Korolev")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("draws a tab per contributed screen and lists only that screen's departments", async () => {
    registerContribution({
      id: "test-programs-screen",
      contributes: "strategies.screens",
      compute: () => [
        {
          id: "programs",
          label: "Programs",
          order: 10,
          departments: ["Programs"],
        },
      ],
    });
    const { stream } = renderWidget();
    act(() => {
      emitCareer(stream, RP1_CAREER);
    });

    const tablist = await screen.findByRole("tablist", {
      name: "Administration Building screens",
    });
    expect(
      within(tablist)
        .getAllByRole("tab")
        .map((t) => t.textContent),
    ).toEqual(["Programs", "Other"]);

    expect(screen.getByText("Early Sounding Rockets")).toBeTruthy();
    // Leaders belong to no contributed screen, so they are on the trailing one
    // and not on this one.
    expect(screen.queryByText("Sergei Korolev")).toBeNull();
  });

  it("keeps the unclaimed strategies reachable on the trailing screen", async () => {
    registerContribution({
      id: "test-programs-screen",
      contributes: "strategies.screens",
      compute: () => [
        { id: "programs", label: "Programs", departments: ["Programs"] },
      ],
    });
    const user = userEvent.setup();
    const { stream } = renderWidget();
    act(() => {
      emitCareer(stream, RP1_CAREER);
    });
    await screen.findByRole("tablist");

    await user.click(screen.getByRole("tab", { name: "Other" }));
    expect(screen.getByText("Sergei Korolev")).toBeTruthy();
    expect(screen.queryByText("Early Sounding Rockets")).toBeNull();
  });

  it("moves between screens on the arrow keys, per the tablist pattern", async () => {
    registerContribution({
      id: "test-programs-screen",
      contributes: "strategies.screens",
      compute: () => [
        { id: "programs", label: "Programs", departments: ["Programs"] },
      ],
    });
    const user = userEvent.setup();
    const { stream } = renderWidget();
    act(() => {
      emitCareer(stream, RP1_CAREER);
    });
    await screen.findByRole("tablist");

    const programs = screen.getByRole("tab", { name: "Programs" });
    programs.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Other" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(programs).toHaveAttribute("aria-selected", "false");
  });

  /*
   * The honest-empty-state half. RP-1 ships six `leaderLocked*` strategies
   * carrying `cannotActivative = True`, one per department, whose entire purpose
   * is to display an unlock condition; a screen gated the same way has to be able
   * to say so. The screen exists, is labelled, is REACHABLE, and states its
   * reason: a screen that were merely absent would be indistinguishable from an
   * Uplink bundle that failed to load.
   */
  it("draws a locked screen as a reachable tab that states why it will not open", async () => {
    registerContribution({
      id: "test-locked-screen",
      contributes: "strategies.screens",
      compute: () => [
        { id: "programs", label: "Programs", departments: ["Programs"] },
        {
          id: "leaders",
          label: "Leaders",
          departments: ["Engineering", "Administration"],
          enabled: false,
          disabledReason:
            "Administrators will unlock once you complete the Karman Line contract.",
        },
      ],
    });
    const user = userEvent.setup();
    const { stream } = renderWidget();
    act(() => {
      emitCareer(stream, RP1_CAREER);
    });
    await screen.findByRole("tablist");

    const leaders = screen.getByRole("tab", { name: "Leaders" });
    expect(leaders).not.toBeDisabled();

    await user.click(leaders);
    expect(leaders).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByText(/Administrators will unlock once you complete/),
    ).toBeTruthy();
    // Locked means locked: none of the screen's own strategies are drawn.
    expect(screen.queryByText("Sergei Korolev")).toBeNull();
  });

  it("composes an augment into the selected screen's body", async () => {
    registerContribution({
      id: "test-programs-screen",
      contributes: "strategies.screens",
      compute: () => [
        { id: "programs", label: "Programs", departments: ["Programs"] },
      ],
    });
    registerAugment({
      id: "test-programs-body",
      augments: "strategies.screen-body",
      component: ({ screenId }: { screenId: string }) => (
        <div data-testid="screen-body">body for {screenId}</div>
      ),
    });
    const { stream } = renderWidget();
    act(() => {
      emitCareer(stream, RP1_CAREER);
    });
    await screen.findByRole("tablist");

    await waitFor(() =>
      expect(screen.getByTestId("screen-body")).toHaveTextContent(
        "body for programs",
      ),
    );
  });

  /*
   * Caught by looking at the render rather than by a test: inside the Programs
   * tab every card carried a "PROGRAMS" chip, which is the tab's own name written
   * out once per row.
   */
  it("drops the department chip on a screen that IS one department, and keeps it on Other", async () => {
    registerContribution({
      id: "test-programs-screen",
      contributes: "strategies.screens",
      compute: () => [
        { id: "programs", label: "Programs", departments: ["Programs"] },
      ],
    });
    const user = userEvent.setup();
    const { stream } = renderWidget();
    act(() => {
      emitCareer(stream, RP1_CAREER);
    });
    await screen.findByRole("tablist");
    expect(screen.queryByText("Programs", { ignore: "[role=tab]" })).toBeNull();

    // The trailing screen gathers several departments and its label names none
    // of them, so there the chip is the only thing that says which is which.
    await user.click(screen.getByRole("tab", { name: "Other" }));
    expect(screen.getByText("Engineering")).toBeTruthy();
    expect(screen.getByText("Administration")).toBeTruthy();
  });

  it("keeps the department chip in the ungrouped widget, whatever it holds", async () => {
    const { stream } = renderWidget();
    act(() => {
      emitCareer(stream, [RP1_CAREER[0]]);
    });
    expect(await screen.findByText("Early Sounding Rockets")).toBeTruthy();
    expect(screen.getByText("Programs")).toBeTruthy();
  });

  it("has no axe violations with the tab strip up", async () => {
    registerContribution({
      id: "test-programs-screen",
      contributes: "strategies.screens",
      compute: () => [
        { id: "programs", label: "Programs", departments: ["Programs"] },
      ],
    });
    const { stream, container } = renderWidget();
    act(() => {
      emitCareer(stream, RP1_CAREER);
    });
    await screen.findByRole("tablist");
    await expectNoA11yViolations(container);
  });
});
