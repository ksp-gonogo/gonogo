import { resetSettingsForTests } from "@ksp-gonogo/core";
import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
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
import {
  resetSitrepRuntimeForTests,
  setSitrepHostConfig,
} from "../telemetry/sitrepRuntime";
import { useHostJobsConnection } from "./HostingProvider";
import { HostJobs } from "./HostJobs";

const oldLink = ws.link("ws://localhost:8090");
const newLink = ws.link("ws://192.0.2.50:8090");
const server = setupServer();

beforeAll(() => server.listen());
beforeEach(() => {
  localStorage.clear();
  resetSettingsForTests();
  resetSitrepRuntimeForTests();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("useHostJobsConnection: host change", () => {
  it("closes its socket to the old host and stops retrying it", async () => {
    let oldOpens = 0;
    let newOpens = 0;
    server.use(
      oldLink.addEventListener("connection", ({ client }) => {
        oldOpens++;
        client.close();
      }),
      newLink.addEventListener("connection", () => {
        newOpens++;
      }),
    );

    const jobs = new HostJobs();
    renderHook(() => useHostJobsConnection(jobs, true));
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
