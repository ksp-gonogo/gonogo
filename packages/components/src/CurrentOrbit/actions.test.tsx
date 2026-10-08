import {
  clearActionHandlers,
  DashboardItemContext,
  dispatchAction,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import type { CurrentOrbitConfig } from "./config";
import { CurrentOrbitComponent } from "./index";

const INSTANCE = "orbit-actions";

function Persisted() {
  const [config, setConfig] = useState<CurrentOrbitConfig>({});
  return (
    <CurrentOrbitComponent
      id={INSTANCE}
      config={config}
      onConfigChange={setConfig}
    />
  );
}

describe("CurrentOrbit actions", () => {
  let container: HTMLElement;

  beforeEach(async () => {
    registerStockBodies();
    const stream = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
    ({ container } = render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: INSTANCE }}>
          <Persisted />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    ));
    act(() => {
      stream.emit(
        "vessel.orbit",
        {
          referenceBodyIndex: 1,
          sma: 681_500,
          ecc: 0.005135,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: 0,
          mu: 3.5316e12,
          horizon: ANALYTIC_UNBOUNDED_HORIZON,
        },
        { quality: Quality.OnRails },
      );
      stream.emit("vessel.identity", {
        vesselId: "v1",
        name: "Kerbal X",
        vesselType: 0,
        situation: 1,
        parentBodyIndex: 1,
        launchUt: 0,
      });
      stream.emit("system.bodies", {
        bodies: [{ index: 1, name: "Kerbin", parentIndex: 0, radius: 600000 }],
      });
    });
    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
  });

  afterEach(() => {
    clearActionHandlers();
  });

  it("toggle-diagram hides the orbit diagram, then shows it again", async () => {
    let result: unknown;
    act(() => {
      result = dispatchAction(INSTANCE, "toggle-diagram", {
        kind: "button",
        value: true,
      });
    });
    expect(result).toEqual({ diagramVisible: false });
    await waitFor(() => expect(container.querySelector("svg")).toBeNull());

    act(() => {
      result = dispatchAction(INSTANCE, "toggle-diagram", {
        kind: "button",
        value: true,
      });
    });
    expect(result).toEqual({ diagramVisible: true });
    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
  });

  it("toggle-diagram ignores the release of the button", () => {
    let result: unknown = "unset";
    act(() => {
      result = dispatchAction(INSTANCE, "toggle-diagram", {
        kind: "button",
        value: false,
      });
    });
    expect(result).toBeUndefined();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
