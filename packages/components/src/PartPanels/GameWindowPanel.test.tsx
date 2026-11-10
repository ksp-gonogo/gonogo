import {
  clearPartPanels,
  getPartPanelFallbacks,
  type PartPanelFallbackButton,
  registerPartPanel,
  registerPartPanelFallback,
} from "@ksp-gonogo/sitrep-sdk";
import { renderHook } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePartPanelRoutes } from "../ShipMap/partPanels";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { EXPERIMENTAL_TIP, gameWindowFallback } from "./GameWindowPanel";

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

  it("lets a panel that names the button take it", () => {
    const route = {
      id: "test:route",
      title: "Console Targeting",
      component: () => <p>console</p>,
      replaces: [{ module: "ModuleExample", event: "AntennaTargetGUI" }],
    };
    const remove = registerPartPanelFallback(gameWindowFallback);
    registerPartPanel(route);

    const { result } = renderHook(() => usePartPanelRoutes());
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
    remove();
    expect(getPartPanelFallbacks()).toHaveLength(0);
  });
});
