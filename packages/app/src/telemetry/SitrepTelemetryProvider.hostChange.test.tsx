import { clearRegistry, resetSettingsForTests } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { ws } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { SitrepTelemetryProvider } from "./SitrepTelemetryProvider";
import {
  resetSitrepRuntimeForTests,
  setSitrepHostConfig,
} from "./sitrepRuntime";

const oldLink = ws.link("ws://localhost:8090");
const newLink = ws.link("ws://192.0.2.50:8090");
const server = setupServer();

beforeAll(() => server.listen());
beforeEach(() => {
  localStorage.clear();
  resetSettingsForTests();
  resetSitrepRuntimeForTests();
  clearRegistry();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("SitrepTelemetryProvider: host change", () => {
  it("stops opening sockets to the old host once the host is changed", async () => {
    let oldOpens = 0;
    let newOpens = 0;
    server.use(
      oldLink.addEventListener("connection", () => {
        oldOpens++;
      }),
      newLink.addEventListener("connection", () => {
        newOpens++;
      }),
    );

    render(
      <SitrepTelemetryProvider>
        <div>child</div>
      </SitrepTelemetryProvider>,
    );
    await waitFor(() => expect(oldOpens).toBeGreaterThan(0));

    act(() => {
      setSitrepHostConfig({ host: "192.0.2.50", port: 8090 });
    });
    await waitFor(() => expect(newOpens).toBeGreaterThan(0));

    const afterSwitch = oldOpens;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 4000));
    });
    expect(oldOpens).toBe(afterSwitch);
  }, 15000);
});
