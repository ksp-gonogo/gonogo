import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { GameMode } from "@ksp-gonogo/sitrep-sdk";
import { act, render as rtlRender, screen } from "@ksp-gonogo/test-utils";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdministrationBuildingComponent } from "../AdministrationBuilding";
import { ContractManagerComponent } from "../ContractManager";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";

const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

/**
 * A science save sends nothing on `career.status.strategies` or `.contracts`,
 * so the widgets can only learn the mode has none from `career.mode`, which is
 * sent in every mode. A career save whose board has not arrived still waits.
 */
describe.each([
  {
    name: "Administration Building",
    waiting: /Awaiting career data/,
    science: "Science mode has no funds or strategies",
    sandbox: "Sandbox has no funds or strategies",
    Widget: AdministrationBuildingComponent,
  },
  {
    name: "Contract Manager",
    waiting: /Awaiting contract telemetry/,
    science: "Science mode has no funds or contracts",
    sandbox: "Sandbox has no funds or contracts",
    Widget: ContractManagerComponent,
  },
])("$name in a save without a career", ({
  waiting,
  science,
  sandbox,
  Widget,
}) => {
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
        <DashboardItemContext.Provider value={{ instanceId: "nc" }}>
          <Widget config={{}} id="nc" w={9} h={12} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
  }

  it("says a science save has none, and never reads as waiting", () => {
    renderWidget();
    act(() => fixture.emit("career.mode", { mode: GameMode.Science }));

    expect(screen.getByText(science)).toBeInTheDocument();
    expect(screen.queryByText(waiting)).toBeNull();
  });

  it("says a sandbox save has none", () => {
    renderWidget();
    act(() => fixture.emit("career.mode", { mode: GameMode.Sandbox }));

    expect(screen.getByText(sandbox)).toBeInTheDocument();
  });

  it("keeps waiting in a career save whose board has not arrived", () => {
    renderWidget();
    act(() => fixture.emit("career.mode", { mode: GameMode.Career }));

    expect(screen.getByText(waiting)).toBeInTheDocument();
  });
});
