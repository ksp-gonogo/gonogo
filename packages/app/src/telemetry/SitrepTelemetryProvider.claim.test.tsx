import { clearRegistry } from "@ksp-gonogo/core";
import { render, waitFor } from "@ksp-gonogo/test-utils";
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
import { resetSitrepRuntimeForTests } from "./sitrepRuntime";

/**
 * A screen reloaded while a command was held: the mod sees its page's own
 * outstanding request ids in a claim on the new connection, and a different
 * screen's ids never go out.
 */

const link = ws.link("ws://localhost:8090");
const server = setupServer();

beforeAll(() => server.listen());
beforeEach(() => {
  localStorage.clear();
  resetSitrepRuntimeForTests();
  clearRegistry();
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => server.close());

function storeOutstanding(screenKey: string, requestId: string) {
  localStorage.setItem(
    `gonogo.sitrep.outstandingCommands.v1.${screenKey}`,
    JSON.stringify([
      {
        requestId,
        command: "vessel.control.setActionGroup",
        args: { group: "Custom01", state: true },
        label: "",
        etaConfirm: 100,
      },
    ]),
  );
}

function recordFrames() {
  const frames: { type: string; requestIds?: string[] }[] = [];
  server.use(
    link.addEventListener("connection", ({ client }) => {
      client.addEventListener("message", (event) => {
        frames.push(JSON.parse(String(event.data)));
      });
    }),
  );
  return frames;
}

describe("SitrepTelemetryProvider claims the commands its screen left outstanding", () => {
  it("sends the screen's stored request ids in a claim once connected", async () => {
    storeOutstanding("main", "old-7");
    const frames = recordFrames();

    render(
      <SitrepTelemetryProvider screenKey="main">
        <div>child</div>
      </SitrepTelemetryProvider>,
    );

    await waitFor(() =>
      expect(frames).toContainEqual({ type: "claim", requestIds: ["old-7"] }),
    );
  });

  it("does not send another screen's stored request ids", async () => {
    storeOutstanding("pilot", "old-8");
    const frames = recordFrames();

    render(
      <SitrepTelemetryProvider screenKey="main">
        <div>child</div>
      </SitrepTelemetryProvider>,
    );

    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    expect(frames.some((frame) => frame.type === "claim")).toBe(false);
  });
});
