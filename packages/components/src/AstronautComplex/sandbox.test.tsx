import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { GameMode } from "@ksp-gonogo/sitrep-sdk";
import { act, render as rtlRender, screen } from "@ksp-gonogo/test-utils";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { AstronautComplexComponent } from "./index";

const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

/**
 * A sandbox or science save has no Astronaut Complex pool, and the mod sends
 * nothing on `spaceCenter.astronautComplex` for it, so the widget can only
 * learn the save has no hiring from `career.mode`, which is sent in every mode.
 */
describe("AstronautComplex in a save without hiring", () => {
  let fixture: StreamFixture;

  beforeEach(() => {
    fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  });

  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    clearActionHandlers();
  });

  function renderWidget() {
    return render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ac" }}>
          <AstronautComplexComponent config={{}} id="ac" w={6} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
  }

  it("says plainly that a sandbox has no crew to hire, and never reads as waiting", () => {
    renderWidget();
    act(() => fixture.emit("career.mode", { mode: GameMode.Sandbox }));

    expect(screen.getByText("Sandbox: no crew to hire")).toBeInTheDocument();
    expect(screen.queryByText(/waiting for telemetry/i)).toBeNull();
  });

  it("names a science save as such", () => {
    renderWidget();
    act(() => fixture.emit("career.mode", { mode: GameMode.Science }));

    expect(screen.getByText("Science: no crew to hire")).toBeInTheDocument();
  });

  it("keeps waiting in a career save whose pool has not arrived", () => {
    renderWidget();
    act(() => fixture.emit("career.mode", { mode: GameMode.Career }));

    expect(screen.getByText(/waiting for telemetry/i)).toBeInTheDocument();
    expect(screen.queryByText(/no crew to hire/i)).toBeNull();
  });
});
