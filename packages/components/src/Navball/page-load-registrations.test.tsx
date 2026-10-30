import {
  clearActionHandlers,
  DashboardItemContext,
  PerfBudget,
} from "@ksp-gonogo/core";
import { render } from "@ksp-gonogo/test-utils";
import { afterEach, expect, it } from "vitest";
import { LaunchDirectorComponent } from "../LaunchDirector/index";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

afterEach(() => clearActionHandlers());

it("mounting Navball and Launch & Recovery together does not count as re-registration", async () => {
  const budget = PerfBudget.getAll().find(
    (b) => b.name === "useActionInput re-registrations/sec",
  );
  expect(budget).toBeDefined();
  budget?.reset();
  const cmd = await setupMockDataSource({ keys: [] });
  const stream = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
  render(
    <stream.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "navball" }}>
        <NavballComponent config={{}} id="navball" w={10} h={20} />
      </DashboardItemContext.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "launch" }}>
        <LaunchDirectorComponent id="launch" h={18} />
      </DashboardItemContext.Provider>
    </stream.Provider>,
  );
  expect(budget?.windowTotal()).toBe(0);
  teardownMockDataSource(cmd);
});
