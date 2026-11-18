import { registerAugment } from "@ksp-gonogo/core";
import type {
  ModeDefinition,
  ModeSectionProps,
  ModeTimeline,
} from "@ksp-gonogo/sitrep-sdk";
import { act, fireEvent, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { ModalProvider } from "@ksp-gonogo/ui-kit";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModePane } from "./ModePane";

function Plan({ reportStatus }: ModeSectionProps) {
  useEffect(
    () => reportStatus({ label: "Fails at step 3", tone: "nogo" }),
    [reportStatus],
  );
  return <p>Steps here</p>;
}

for (const mode of ["design", "default"] as const) {
  registerAugment({
    id: `test-plan.${mode}`,
    augments: `mode-sections.${mode}`,
    label: "Test Plan",
    component: Plan,
  });
}

registerAugment({
  id: "test-boot",
  augments: "mode-sections.design",
  label: "Test Boot",
  priority: 10,
  component: () => <p>boot/ascent.ks</p>,
});

const DESIGN: ModeDefinition = {
  id: "design",
  name: "Design",
  useActive: () => true,
  useTimeline: () => undefined,
  noTimeline: "No predicted run",
};

const DEFAULT: ModeDefinition = {
  id: "default",
  name: "Default",
  useActive: () => true,
};

const REPLAY: ModeDefinition = {
  id: "replay",
  name: "Replay",
  useActive: () => true,
};

function mockWidth(narrow: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: narrow,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function renderPane(mode: ModeDefinition) {
  return render(
    <ModalProvider>
      <ModePane mode={mode} title="Mun Hopper rev 15" />
    </ModalProvider>,
  );
}

describe("ModePane", () => {
  it("docks every section of the mode at the side on a wide screen, under one title row", async () => {
    mockWidth(false);
    const { container } = renderPane(DESIGN);
    expect(
      screen.getByRole("complementary", { name: "Mun Hopper rev 15 pane" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Test Plan/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Test Boot/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Fails at step 3")).toHaveLength(1);
    await expectNoA11yViolations(container);
  });

  it("keeps the Timeline on screen in design mode, saying so while there is no run", () => {
    mockWidth(false);
    renderPane(DESIGN);
    const bar = screen.getByRole("region", { name: "Timeline" });
    expect(bar).toHaveTextContent("No predicted run");
  });

  it("shows no Timeline for a live flight, and a Timeline with no pane for a recording", () => {
    mockWidth(false);
    const { unmount } = renderPane(DEFAULT);
    expect(screen.queryByRole("region", { name: "Timeline" })).toBeNull();
    unmount();
    const seek = vi.fn();
    const recording: ModeTimeline = {
      start: 100,
      end: 254,
      at: 161,
      seek,
      playback: {
        playing: false,
        rate: 1,
        rates: [1, 2],
        play: () => {},
        pause: () => {},
        setRate: () => {},
        exit: () => {},
      },
    };
    renderPane({ ...REPLAY, useTimeline: () => recording });
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getByRole("button", { name: /Exit replay/ })).toBeVisible();
    fireEvent.change(screen.getByRole("slider", { name: "Timeline" }), {
      target: { value: "200" },
    });
    expect(seek).toHaveBeenLastCalledWith(200);
  });

  it("gives the default mode a pane once a section is bound to its slot", () => {
    mockWidth(false);
    renderPane(DEFAULT);
    expect(
      screen.getByRole("complementary", { name: "Mun Hopper rev 15 pane" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Timeline" })).toBeNull();
  });

  it("shows only the sections bound to the mode's slot", () => {
    mockWidth(false);
    renderPane(DEFAULT);
    expect(
      screen.getByRole("heading", { name: /Test Plan/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Test Boot/ })).toBeNull();
  });

  it("draws nothing for a mode with no pane and no Timeline", () => {
    mockWidth(false);
    const { container } = renderPane(REPLAY);
    expect(container).toBeEmptyDOMElement();
  });

  it("has no control to close or collapse it on a wide screen", () => {
    mockWidth(false);
    renderPane(DESIGN);
    expect(
      screen.queryByRole("button", { name: /collapse|close|open/i }),
    ).toBeNull();
  });

  it("is a bottom sheet on a phone, minimised to its title row and Timeline until lifted", () => {
    mockWidth(true);
    renderPane(DESIGN);
    expect(screen.getByText("Mun Hopper rev 15")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Timeline" })).toBeVisible();
    expect(screen.getByText("Steps here")).not.toBeVisible();
    // The state shows once on screen: on the minimised sheet's title row.
    const shown = screen
      .getAllByText("Fails at step 3")
      .filter((el) => el.closest("[hidden]") === null);
    expect(shown).toHaveLength(1);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Raise pane" }));
    });
    expect(screen.getByText("Steps here")).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Raise pane" }));
    });
    expect(
      screen.getAllByRole("button", { name: "Lower pane" }).length,
    ).toBeGreaterThan(0);
  });
});
