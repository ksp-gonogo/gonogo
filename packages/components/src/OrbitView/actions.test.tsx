import {
  clearActionHandlers,
  DashboardItemContext,
  dispatchAction,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emitScenario } from "../test/orbitScenario";
import { setupStreamFixture } from "../test/setupStreamFixture";
import type { OrbitViewConfig } from "./config";
import { OrbitViewComponent } from "./index";

const INSTANCE = "orbitview-actions";

function Persisted() {
  const [config, setConfig] = useState<OrbitViewConfig>({});
  return (
    <OrbitViewComponent
      id={INSTANCE}
      w={9}
      h={18}
      config={config}
      onConfigChange={setConfig}
    />
  );
}

const periapsisMarker = () => screen.queryByLabelText(/^Periapsis altitude/);

describe("OrbitView actions", () => {
  beforeEach(async () => {
    const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: INSTANCE }}>
          <Persisted />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    emitScenario(fixture, {
      bodyName: "Kerbin",
      sma: 681_500,
      ecc: 0.005,
      argPe: 0,
    });
    await waitFor(() => expect(periapsisMarker()).not.toBeNull());
  });

  afterEach(() => {
    clearActionHandlers();
  });

  it("toggle-markers hides the apsis markers, then shows them again", async () => {
    let result: unknown;
    act(() => {
      result = dispatchAction(INSTANCE, "toggle-markers", {
        kind: "button",
        value: true,
      });
    });
    expect(result).toEqual({ markersVisible: false });
    await waitFor(() => expect(periapsisMarker()).toBeNull());
    expect(screen.queryByLabelText(/^Apoapsis altitude/)).toBeNull();

    act(() => {
      result = dispatchAction(INSTANCE, "toggle-markers", {
        kind: "button",
        value: true,
      });
    });
    expect(result).toEqual({ markersVisible: true });
    await waitFor(() => expect(periapsisMarker()).not.toBeNull());
  });

  it("toggle-markers ignores the release of the button", () => {
    let result: unknown = "unset";
    act(() => {
      result = dispatchAction(INSTANCE, "toggle-markers", {
        kind: "button",
        value: false,
      });
    });
    expect(result).toBeUndefined();
    expect(periapsisMarker()).not.toBeNull();
  });
});
