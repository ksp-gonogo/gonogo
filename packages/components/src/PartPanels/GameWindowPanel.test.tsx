import {
  clearPartPanels,
  getPartPanelFallbacks,
  type PartPanelFallbackButton,
  registerPartPanel,
  registerPartPanelFallback,
} from "@ksp-gonogo/sitrep-sdk";
import { installTestHost, renderHook } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, cleanup, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { DelayRailProvider } from "@ksp-gonogo/ui-kit";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePartPanelRoutes } from "../ShipMap/partPanels";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { EXPERIMENTAL_TIP, gameWindowFallback } from "./GameWindowPanel";
import { GameWindowAudienceContext } from "./gameWindowAudience";
import { ReviewDataPanel } from "./ReviewDataPanel";

const TOPIC = "vessel.gameWindows";
const PART_ID = "123";

const IMGUI_BUTTON: PartPanelFallbackButton = {
  module: "ModuleExample",
  event: "AntennaTargetGUI",
  label: "Antenna Targeting",
};

const UGUI_BUTTON: PartPanelFallbackButton = {
  module: null,
  event: "SetVesselNaming",
  label: "Configure Vessel Naming",
};

const IMGUI_WINDOW = {
  id: "imgui:4242",
  technology: "imgui",
  title: "Antenna Targeting",
  openedBy: {
    partId: PART_ID,
    module: "ModuleExample",
    event: "AntennaTargetGUI",
    label: "Antenna Targeting",
  },
  root: {
    id: "w",
    kind: "group",
    dir: "v",
    children: [
      { id: "w/label0", kind: "label", text: "Target: Kerbin" },
      {
        id: "w/group0",
        kind: "group",
        dir: "h",
        children: [
          { id: "w/group0/label0", kind: "label", text: "Azimuth" },
          { id: "w/group0/textfield0", kind: "textfield", text: "12" },
        ],
      },
      { id: "w/button0:Apply", kind: "button", text: "Apply" },
      { id: "w/button0:Off", kind: "button", text: "Off", enabled: false },
    ],
  },
};

const UGUI_WINDOW = {
  id: "ugui:-99",
  technology: "ugui",
  title: "Set Vessel Name",
  openedBy: {
    partId: PART_ID,
    module: null,
    event: "SetVesselNaming",
    label: "Configure Vessel Naming",
  },
  root: {
    id: "w",
    kind: "group",
    dir: "v",
    children: [
      {
        id: "w/toggle0:ToggleProbe",
        kind: "toggle",
        text: "Probe",
        bool: false,
      },
      { id: "w/slider0:Slider", kind: "slider", num: 10, min: 1, max: 20 },
      { id: "w/button0:ButtonAccept", kind: "button", text: "Accept" },
    ],
  },
};

function mount(button: PartPanelFallbackButton, delaySeconds = 0) {
  const fixture = setupStreamFixture({ pinnedUt: 100, delaySeconds });
  const panel = gameWindowFallback(button);
  if (!panel) throw new Error("no panel for the button");
  const Content = panel.component;
  const close = vi.fn();
  const { container } = render(
    <fixture.Provider>
      <Content partId={PART_ID} partTitle="Antenna" close={close} />
    </fixture.Provider>,
  );
  return { fixture, close, panel, container };
}

async function emitWindows(
  fixture: ReturnType<typeof setupStreamFixture>,
  windows: unknown[],
  validAt = 100,
) {
  await act(async () => {
    fixture.emit(TOPIC, { windows }, { validAt });
    fixture.store.beginFrame();
  });
}

function sent(fixture: ReturnType<typeof setupStreamFixture>, command: string) {
  return fixture.transport.sentCommands.filter((c) => c.command === command);
}

describe("GameWindowPanel", () => {
  beforeEach(() => {
    clearPartPanels();
  });

  it("waits for the window the part menu's press opens and draws the immediate-mode window", async () => {
    const { fixture } = mount(IMGUI_BUTTON);
    await emitWindows(fixture, []);

    expect(sent(fixture, "vessel.invokePartAction")).toHaveLength(0);
    expect(screen.getByText("Opening the game window...")).toBeInTheDocument();

    await emitWindows(fixture, [IMGUI_WINDOW]);
    expect(await screen.findByText("Target: Kerbin")).toBeInTheDocument();
    expect(screen.getByLabelText("Azimuth")).toHaveValue("12");

    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(sent(fixture, "vessel.gameWindow.press")[0]?.args).toEqual({
        windowId: "imgui:4242",
        controlId: "w/button0:Apply",
      }),
    );
    await act(async () => {});
  });

  describe("when no window opens", () => {
    const OPENING = "Opening the game window...";
    const NONE = "The game did not open a window.";

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const advance = (seconds: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(seconds * 1000);
      });

    it("says so a short while after the panel opens", async () => {
      mount(IMGUI_BUTTON);
      await advance(0);

      await advance(4.9);
      expect(screen.getByText(OPENING)).toBeInTheDocument();
      await advance(0.2);
      expect(screen.getByText(NONE)).toBeInTheDocument();
    });

    it("waits the signal delay out and back before saying so", async () => {
      mount(IMGUI_BUTTON, 10);
      await advance(0);

      await advance(24.9);
      expect(screen.getByText(OPENING)).toBeInTheDocument();
      await advance(0.2);
      expect(screen.getByText(NONE)).toBeInTheDocument();
    });

    it("says nothing once the window has opened", async () => {
      const { fixture } = mount(IMGUI_BUTTON);
      await emitWindows(fixture, [IMGUI_WINDOW]);
      await advance(60);
      expect(screen.queryByText(NONE)).not.toBeInTheDocument();
      expect(screen.getByText("Target: Kerbin")).toBeInTheDocument();
    });
  });

  it("sends text typed in a field before the press of the button that follows", async () => {
    const { fixture } = mount(IMGUI_BUTTON);
    await emitWindows(fixture, [IMGUI_WINDOW]);
    const field = await screen.findByLabelText("Azimuth");

    await userEvent.clear(field);
    await userEvent.type(field, "45");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(
        sent(fixture, "vessel.gameWindow.press").map((c) => c.args),
      ).toEqual([
        {
          windowId: "imgui:4242",
          controlId: "w/group0/textfield0",
          text: "45",
        },
        { windowId: "imgui:4242", controlId: "w/button0:Apply" },
      ]),
    );
    await act(async () => {});
  });

  it("has no accessibility violations", async () => {
    const { fixture, container } = mount(IMGUI_BUTTON);
    await emitWindows(fixture, [IMGUI_WINDOW]);
    await screen.findByText("Target: Kerbin");
    await expectNoA11yViolations(container);
  });

  it("draws the window of this button and no other window", async () => {
    const other = {
      ...IMGUI_WINDOW,
      id: "imgui:1",
      title: "Other",
      openedBy: { ...IMGUI_WINDOW.openedBy, partId: "999" },
      root: {
        id: "w",
        kind: "group",
        dir: "v",
        children: [{ id: "w/label0", kind: "label", text: "Elsewhere" }],
      },
    };
    const { fixture } = mount(IMGUI_BUTTON);
    await emitWindows(fixture, [other]);
    expect(screen.queryByText("Elsewhere")).not.toBeInTheDocument();

    await emitWindows(fixture, [other, IMGUI_WINDOW]);
    expect(await screen.findByText("Target: Kerbin")).toBeInTheDocument();
    expect(screen.queryByText("Elsewhere")).not.toBeInTheDocument();
  });

  it("draws more than four radios as a wrapping grid, and four or fewer in a column", async () => {
    const radio = (n: number) => ({
      id: `w/group0/radio0:R${n}`,
      kind: "radio",
      text: `Option ${n}`,
      bool: n === 0,
    });
    const windowWith = (count: number) => ({
      ...IMGUI_WINDOW,
      root: {
        id: "w",
        kind: "group",
        dir: "v",
        children: [
          {
            id: "w/group0",
            kind: "group",
            dir: "v",
            children: Array.from({ length: count }, (_, n) => radio(n)),
          },
        ],
      },
    });
    const { fixture } = mount(IMGUI_BUTTON);
    await emitWindows(fixture, [windowWith(5)]);
    const gridOf = (name: string) =>
      screen.getByRole("button", { name }).parentElement;
    expect(
      (await screen.findByText("Option 0")).closest("button"),
    ).toBeTruthy();
    expect(gridOf("Option 0")?.style.display).toBe("grid");

    await emitWindows(fixture, [windowWith(4)]);
    await waitFor(() =>
      expect(gridOf("Option 0")?.style.display).not.toBe("grid"),
    );
  });

  it("draws a retained dialog and sends its toggle's new state", async () => {
    const { fixture } = mount(UGUI_BUTTON);
    await emitWindows(fixture, [UGUI_WINDOW]);

    await userEvent.click(
      await screen.findByRole("checkbox", { name: "Probe" }),
    );
    await waitFor(() =>
      expect(sent(fixture, "vessel.gameWindow.press")[0]?.args).toEqual({
        windowId: "ugui:-99",
        controlId: "w/toggle0:ToggleProbe",
        bool: true,
      }),
    );
    expect(screen.getByRole("slider", { name: "Value" })).toHaveValue("10");
    await act(async () => {});
  });

  it("draws each element as the kit control that reads the same", async () => {
    const { fixture } = mount(IMGUI_BUTTON);
    await emitWindows(fixture, [
      {
        ...IMGUI_WINDOW,
        root: {
          id: "w",
          kind: "group",
          dir: "v",
          children: [
            {
              id: "w/label0",
              kind: "label",
              text: "<b>Bold</b> and <color=#ff5555>red</color>",
            },
            { id: "w/box0", kind: "box", text: "Framed" },
            {
              id: "w/button0:Abort",
              kind: "button",
              text: "Abort",
              tone: "nogo",
            },
            {
              id: "w/toggle0:Plain",
              kind: "toggle",
              text: "Plain",
              bool: true,
            },
            {
              id: "w/toggle0:Styled",
              kind: "toggle",
              text: "Styled",
              bool: false,
              variant: "button",
            },
            {
              id: "w/grid0",
              kind: "grid",
              num: 0,
              columns: 2,
              options: ["One", "Two", "Three"],
            },
            { id: "w/textarea0", kind: "textarea", text: "line one\nline two" },
            { id: "w/image0", kind: "label", image: "Picture" },
            {
              id: "w/button0:Picture",
              kind: "button",
              image: "Picture",
              tooltip: "Open the map",
            },
            {
              id: "w/scroll0",
              kind: "scroll",
              dir: "v",
              children: [
                { id: "w/scroll0/button0:Row", kind: "button", text: "Row" },
              ],
            },
          ],
        },
      },
    ]);

    expect(await screen.findByText("Bold")).toHaveStyle({ fontWeight: "bold" });
    expect(screen.queryByText(/<b>/)).toBeNull();
    expect(screen.getByText("red")).toHaveStyle({
      color: "var(--color-nogo-text)",
    });
    expect(screen.getByRole("button", { name: "Abort" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Plain" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Styled" })).toBeInTheDocument();
    const grid = screen.getByRole("button", { name: "One" }).parentElement;
    expect(grid).toHaveStyle({ display: "grid" });
    expect(
      screen.getByRole("button", { name: "Open the map" }),
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole("button", { name: "Row" })
        .closest("[data-scroll-area-inner]"),
    ).not.toBeNull();
    expect(screen.getByRole("textbox", { name: "Text" })).toHaveValue(
      "line one\nline two",
    );
    await act(async () => {});
  });

  it("closes when the game window closes", async () => {
    const { fixture, close } = mount(IMGUI_BUTTON);
    await emitWindows(fixture, [IMGUI_WINDOW]);
    await screen.findByText("Target: Kerbin");

    await emitWindows(fixture, []);
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it("marks a control greyed out in the game unavailable", async () => {
    const { fixture } = mount(IMGUI_BUTTON);
    await emitWindows(fixture, [IMGUI_WINDOW]);
    await screen.findByText("Target: Kerbin");

    await userEvent.click(screen.getByRole("button", { name: "Off" }));
    await act(async () => {});
    expect(sent(fixture, "vessel.gameWindow.press")).toHaveLength(0);
  });

  it("carries a stale press to the game and shows its refusal", async () => {
    const { fixture } = mount(IMGUI_BUTTON);
    fixture.transport.setCommandHandler((command: string) => {
      if (command !== "vessel.gameWindow.press") return { success: true };
      return {
        success: false,
        errorCode: "notFound",
        detail: "control is no longer in the window",
      };
    });
    await emitWindows(fixture, [IMGUI_WINDOW]);

    await userEvent.click(await screen.findByRole("button", { name: "Apply" }));
    expect(
      await screen.findByText("control is no longer in the window", {
        exact: false,
      }),
    ).toBeInTheDocument();
  });

  it("shows the experimental mark in the title", () => {
    const panel = gameWindowFallback(IMGUI_BUTTON);
    render(<div>{panel?.titleAdornment}</div>);
    const mark = screen.getByRole("img", { name: "Experimental" });
    expect(mark).toHaveAttribute("data-tooltip", EXPERIMENTAL_TIP);
  });

  it("offers no panel for a button that opens no window", () => {
    expect(
      gameWindowFallback({
        module: "ModuleLight",
        event: "LightsOn",
        label: "Lights On",
      }),
    ).toBeUndefined();
  });
});

const CANCELLABLE_WINDOW = {
  ...UGUI_WINDOW,
  root: {
    ...UGUI_WINDOW.root,
    children: [
      ...UGUI_WINDOW.root.children,
      { id: "w/button0:ButtonCancel", kind: "button", text: "Cancel" },
    ],
  },
};

describe("GameWindowPanel delay rail", () => {
  beforeEach(() => {
    clearPartPanels();
  });

  function mountInDialog(delaySeconds: number) {
    const fixture = setupStreamFixture({ pinnedUt: 100, delaySeconds });
    const panel = gameWindowFallback(UGUI_BUTTON);
    if (!panel) throw new Error("no panel for the button");
    const Content = panel.component;
    render(
      <fixture.Provider>
        <DelayRailProvider>
          <Content partId={PART_ID} partTitle="Antenna" close={vi.fn()} />
        </DelayRailProvider>
      </fixture.Provider>,
    );
    return fixture;
  }

  it("shows a press from the form on the rail with its countdown", async () => {
    const fixture = mountInDialog(30);
    await emitWindows(fixture, [UGUI_WINDOW]);
    await userEvent.click(
      await screen.findByRole("button", { name: "Accept" }),
    );

    const [press] = sent(fixture, "vessel.gameWindow.press");
    // The mod accepts the press and lists it on the command centre's queue, as it does for any command.
    await act(async () => {
      fixture.transport.emitRaw({
        type: "command-accepted",
        requestId: press.requestId,
        oneWaySeconds: 30,
      });
      fixture.emit("system.uplink.pending", {
        pending: [
          {
            id: "engine-1",
            clientRequestId: press.requestId,
            command: "vessel.gameWindow.press",
            label: "Accept",
            topic: "",
            vantage: "ground:Kerbin: KSC",
            dispatchedAt: 100,
            oneWaySeconds: 30,
          },
        ],
      });
    });

    expect(
      await screen.findByRole("img", {
        name: "In-flight commands: 1 in flight",
      }),
    ).toBeInTheDocument();
  });

  it("draws no rail for a part panel that supplies its own component", () => {
    const fixture = setupStreamFixture({ pinnedUt: 100, delaySeconds: 30 });
    const { container } = render(
      <fixture.Provider>
        <DelayRailProvider>
          <ReviewDataPanel
            partId={PART_ID}
            partTitle="Antenna"
            close={vi.fn()}
          />
        </DelayRailProvider>
      </fixture.Provider>,
    );

    expect(container.querySelector("[data-panel-rail-frame]")).toBeNull();
  });

  it("draws the rail around a form, and no entry on it until a press is sent", async () => {
    const fixture = mountInDialog(30);
    await emitWindows(fixture, [UGUI_WINDOW]);
    await screen.findByRole("button", { name: "Accept" });

    expect(document.querySelector("[data-panel-rail-frame]")).not.toBeNull();
  });

  it("draws the opening press in the dialog body, and drops it once the mod lists it settled and the form is up", async () => {
    const removeHost = installTestHost({
      useViewClockOptional: () => ({
        utNowEstimate: () => 100,
        confirmedEdgeUt: () => 100,
        onFrame: () => () => {},
      }),
    });
    const fixture = mountInDialog(30);
    const label = `${UGUI_BUTTON.label} on Antenna`;
    const press = {
      id: "engine-1",
      clientRequestId: "press-1",
      command: "vessel.invokePartAction",
      label,
      topic: "",
      vantage: "ground:Kerbin: KSC",
      dispatchedAt: 40,
      oneWaySeconds: 30,
    };
    await act(async () => {
      fixture.emit(
        "system.uplink.pending",
        { pending: [press] },
        { validAt: 100 },
      );
    });
    expect(
      await screen.findByRole("list", {
        name: "Commands on their way to the game",
      }),
    ).toBeInTheDocument();
    // The opening press is drawn in the dialog's body, not on its rail.
    expect(screen.queryByRole("img", { name: /in flight/i })).toBeNull();

    await act(async () => {
      fixture.emit(
        "system.uplink.pending",
        {
          pending: [],
          settled: [{ ...press, settledAt: 100, outcome: "confirmed" }],
        },
        { validAt: 101 },
      );
    });
    await emitWindows(fixture, [UGUI_WINDOW]);
    await screen.findByRole("button", { name: "Accept" });

    expect(
      screen.queryByRole("list", { name: "Commands on their way to the game" }),
    ).toBeNull();
    cleanup();
    removeHost();
  });

  it("does not list on the rail another screen's outcome for the opening press", async () => {
    const removeHost = installTestHost({
      useViewClockOptional: () => ({
        utNowEstimate: () => 100,
        confirmedEdgeUt: () => 100,
        onFrame: () => () => {},
      }),
    });
    const fixture = mountInDialog(30);
    await emitWindows(fixture, [UGUI_WINDOW]);
    await screen.findByRole("button", { name: "Accept" });
    // After the dialog opened, the centre reports another screen's opening press as failed.
    const failed = (command: string, id: string) => ({
      id,
      clientRequestId: id,
      command,
      label: "Rename Vessel on Antenna",
      topic: "",
      vantage: "ground:Kerbin: KSC",
      settledAt: 101,
      outcome: "failed",
      code: "commandUnavailable",
      message: "that command is unavailable",
    });
    await act(async () => {
      fixture.emit(
        "system.uplink.pending",
        {
          pending: [],
          settled: [failed("vessel.invokePartAction", "other-1")],
        },
        { validAt: 100 },
      );
    });

    expect(
      document.querySelector("[data-panel-rail-frame]")?.textContent,
    ).not.toMatch(/failed/);
    cleanup();
    removeHost();
  });

  it("lists a failed press for this window on the rail and not one for another window, from another screen", async () => {
    const removeHost = installTestHost({
      useViewClockOptional: () => ({
        utNowEstimate: () => 100,
        confirmedEdgeUt: () => 100,
        onFrame: () => () => {},
      }),
    });
    const fixture = mountInDialog(30);
    await emitWindows(fixture, [UGUI_WINDOW]);
    await screen.findByRole("button", { name: "Accept" });
    // Settled after the dialog opened, both failed, sent by another screen.
    const failed = (id: string, topic: string, label: string) => ({
      id,
      clientRequestId: id,
      command: "vessel.gameWindow.press",
      label,
      topic,
      vantage: "ground:Kerbin: KSC",
      settledAt: 101,
      outcome: "failed",
      code: "commandUnavailable",
      message: "that command is unavailable",
    });
    await act(async () => {
      fixture.emit(
        "system.uplink.pending",
        {
          pending: [],
          settled: [
            failed("other-1", "ugui:7", "Press in the other window"),
            failed("own-1", UGUI_WINDOW.id, "Press in this window"),
          ],
        },
        { validAt: 100 },
      );
    });

    const rail = document.querySelector("[data-panel-rail-frame]")?.textContent;
    expect(rail).toMatch(/Press in this window/);
    expect(rail).not.toMatch(/Press in the other window/);
    cleanup();
    removeHost();
  });

  it("draws no rail entry for a form with nothing sent", async () => {
    const fixture = mountInDialog(30);
    await emitWindows(fixture, [UGUI_WINDOW]);
    await screen.findByRole("button", { name: "Accept" });

    expect(screen.queryByRole("img", { name: /in flight/i })).toBeNull();
  });
});

describe("GameWindowPanel on the screen that pressed", () => {
  beforeEach(() => {
    clearPartPanels();
  });

  it("draws only a window whose press this screen owns", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 100, delaySeconds: 0 });
    const panel = gameWindowFallback(UGUI_BUTTON);
    if (!panel) throw new Error("no panel for the button");
    const Content = panel.component;
    const withPress = (id: string) => ({
      ...UGUI_WINDOW,
      openedBy: { ...UGUI_WINDOW.openedBy, pressId: id },
    });
    render(
      <fixture.Provider>
        <GameWindowAudienceContext.Provider value={(id) => id === "mine"}>
          <Content partId={PART_ID} partTitle="Antenna" close={vi.fn()} />
        </GameWindowAudienceContext.Provider>
      </fixture.Provider>,
    );

    await emitWindows(fixture, [withPress("another-screen")]);
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.getByText("Opening the game window...")).toBeInTheDocument();

    await emitWindows(fixture, [withPress("mine")]);
    expect(
      await screen.findByRole("button", { name: "Accept" }),
    ).toBeInTheDocument();
  });

  it("shows the press in flight until the window arrives", async () => {
    const removeHost = installTestHost({
      useViewClockOptional: () => ({
        utNowEstimate: () => 100,
        confirmedEdgeUt: () => 100,
        onFrame: () => () => {},
      }),
    });
    const fixture = setupStreamFixture({ pinnedUt: 100, delaySeconds: 30 });
    const panel = gameWindowFallback(UGUI_BUTTON);
    if (!panel) throw new Error("no panel for the button");
    const Content = panel.component;
    render(
      <fixture.Provider>
        <Content partId={PART_ID} partTitle="Antenna" close={vi.fn()} />
      </fixture.Provider>,
    );
    expect(
      screen.queryByRole("list", { name: "Commands on their way to the game" }),
    ).toBeNull();

    await act(async () => {
      fixture.emit("system.uplink.pending", {
        pending: [
          {
            id: "press-1",
            clientRequestId: "press-1",
            command: "vessel.invokePartAction",
            label: `${UGUI_BUTTON.label} on Antenna`,
            topic: "",
            vantage: "ground:Kerbin: KSC",
            dispatchedAt: 100,
            oneWaySeconds: 30,
          },
        ],
      });
    });

    expect(
      await screen.findByRole("list", {
        name: "Commands on their way to the game",
      }),
    ).toBeInTheDocument();
    await emitWindows(fixture, [UGUI_WINDOW]);
    expect(
      await screen.findByRole("button", { name: "Accept" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Commands on their way to the game" }),
    ).toBeNull();
    cleanup();
    removeHost();
  });

  it("closes at once and sends the game the press of its dismiss control", async () => {
    const { fixture, close } = mount(UGUI_BUTTON, 30);
    await emitWindows(fixture, [CANCELLABLE_WINDOW]);
    await screen.findByRole("button", { name: "Accept" });
    cleanup();

    expect(close).not.toHaveBeenCalled();
    expect(sent(fixture, "vessel.gameWindow.press")).toEqual([
      expect.objectContaining({
        args: { windowId: "ugui:-99", controlId: "w/button0:ButtonCancel" },
      }),
    ]);
  });

  it("keeps the window and its dismiss target through a reading that is pending, and closes on an observed absence", async () => {
    const { fixture, close } = mount(UGUI_BUTTON, 30);
    await emitWindows(fixture, [CANCELLABLE_WINDOW]);
    await screen.findByRole("button", { name: "Accept" });

    // The view clock moves to before the first sample, where the reading is pending.
    await act(async () => {
      fixture.scrubTo(50);
    });
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();

    await act(async () => {
      fixture.scrubTo(100);
    });
    await emitWindows(fixture, [], 101);
    await act(async () => {
      fixture.scrubTo(101);
    });
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it("sends the dismiss press of the last window seen when the panel closes during a pending reading", async () => {
    const { fixture } = mount(UGUI_BUTTON, 30);
    await emitWindows(fixture, [CANCELLABLE_WINDOW]);
    await screen.findByRole("button", { name: "Accept" });
    await act(async () => {
      fixture.scrubTo(50);
    });
    cleanup();

    expect(sent(fixture, "vessel.gameWindow.press")).toEqual([
      expect.objectContaining({
        args: { windowId: "ugui:-99", controlId: "w/button0:ButtonCancel" },
      }),
    ]);
  });

  it("sends nothing when the window has no dismiss control or has already gone", async () => {
    const { fixture } = mount(UGUI_BUTTON, 30);
    await emitWindows(fixture, [UGUI_WINDOW]);
    await screen.findByRole("button", { name: "Accept" });
    cleanup();

    expect(sent(fixture, "vessel.gameWindow.press")).toHaveLength(0);
  });
});

/* Last, because the hook renderer installs and then removes the host the in-flight rows read their clock from. */
describe("GameWindowPanel routing", () => {
  beforeEach(() => {
    clearPartPanels();
  });

  it("lets a panel that names the button take it", () => {
    const route = {
      id: "test:route",
      title: "Console Targeting",
      component: () => <p>console</p>,
      replaces: [{ module: "ModuleExample", event: "AntennaTargetGUI" }],
    };
    const remove = registerPartPanelFallback(gameWindowFallback);

    const { result } = renderHook(() => usePartPanelRoutes());
    act(() => {
      registerPartPanel(route);
    });
    expect(
      result.current.forGameButton(
        IMGUI_BUTTON.module,
        IMGUI_BUTTON.event,
        IMGUI_BUTTON.label,
      )?.id,
    ).toBe("test:route");
    expect(
      result.current.forGameButton(
        UGUI_BUTTON.module,
        UGUI_BUTTON.event,
        UGUI_BUTTON.label,
      )?.id,
    ).toBe("game-window::SetVesselNaming");
    act(() => {
      remove();
    });
    expect(getPartPanelFallbacks()).toHaveLength(0);
  });
});
