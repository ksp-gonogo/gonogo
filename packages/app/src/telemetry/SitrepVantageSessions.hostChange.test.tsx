import { resetSettingsForTests } from "@ksp-gonogo/core";
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
import { HOME_SESSION } from "../peer/PeerHostService";
import {
  SitrepVantageSessions,
  type VantageSessionHost,
} from "./SitrepVantageSessions";
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
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const host: VantageSessionHost = {
  onRequestedVantagesChanged: (cb) => {
    cb([HOME_SESSION]);
    return () => {};
  },
  attachSitrepSinkFor: () => () => {},
  broadcastToVantage: () => {},
};

describe("SitrepVantageSessions: host change", () => {
  it("moves its open sessions to the new host and stops opening sockets to the old one", async () => {
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

    render(<SitrepVantageSessions peerHost={host} />);
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
