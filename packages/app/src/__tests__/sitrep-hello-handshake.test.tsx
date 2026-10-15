import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { ws } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SitrepTelemetryProvider } from "../telemetry/SitrepTelemetryProvider";
import {
  getSitrepHello,
  getSitrepTransportStatus,
  resetSitrepRuntimeForTests,
} from "../telemetry/sitrepRuntime";

const link = ws.link("ws://localhost:8090");
const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  resetSitrepRuntimeForTests();
});
afterAll(() => server.close());

async function mountAfterHello(hello: Record<string, unknown>) {
  server.use(
    link.addEventListener("connection", ({ client }) => {
      client.send(JSON.stringify({ type: "hello", ...hello }));
    }),
  );
  render(
    <SitrepTelemetryProvider enabled host="localhost" port={8090}>
      <span />
    </SitrepTelemetryProvider>,
  );
  await waitFor(() => expect(getSitrepTransportStatus()).toBe("connected"));
  await waitFor(() => expect(getSitrepHello()).toBeDefined());
  await act(async () => {});
}

describe("the mod's hello reaches the app", () => {
  it("records the mod version and contract the hello names", async () => {
    await mountAfterHello({
      bootId: "a",
      modVersion: "v1.4.0",
      contractMajor: 44,
      contractMinor: 2,
    });

    expect(getSitrepHello()).toEqual({
      modVersion: "v1.4.0",
      contractMajor: 44,
      contractMinor: 2,
    });
  });

  it("records a hello from a mod that sends no version as having no contract", async () => {
    await mountAfterHello({ bootId: "a" });

    expect(getSitrepHello()?.contractMajor).toBeUndefined();
  });
});
