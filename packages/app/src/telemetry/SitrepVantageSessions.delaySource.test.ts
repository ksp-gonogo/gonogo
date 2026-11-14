import { ws } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { openLiveSession } from "./SitrepVantageSessions";
import { resetSitrepRuntimeForTests } from "./sitrepRuntime";

const link = ws.link("ws://localhost:8090");
const server = setupServer(link.addEventListener("connection", () => {}));

beforeAll(() => {
  resetSitrepRuntimeForTests();
  server.listen();
});
afterAll(() => server.close());

describe("a live extra-vantage session", () => {
  it("can settle a command nothing answers, so dispatching through it does not warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const session = openLiveSession("vessel:abc-123");
    session.command
      ?.dispatch("vessel.control.setSas", { enabled: true })
      .result.catch(() => {});
    const messages = warn.mock.calls.map((c) => String(c[0]));
    warn.mockRestore();
    session.dispose();
    expect(messages.filter((m) => m.includes("no delay authority"))).toEqual(
      [],
    );
  });
});
