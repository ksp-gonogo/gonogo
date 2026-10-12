import { describe, expect, it, vi } from "vitest";
import { startCoturn } from "../coturnManager.js";

const logger = { info: vi.fn(), error: vi.fn() };

describe("startCoturn", () => {
  it("reports not running once the process has exited", async () => {
    // `false` ignores its arguments and exits 1, which is what a coturn that cannot bind its port does.
    const handle = startCoturn({
      externalIp: "203.0.113.1",
      binaryPath: "false",
      logger,
    });
    expect(handle.running()).toBe(true);
    await vi.waitFor(() => expect(handle.running()).toBe(false));
    await handle.stop();
  });

  it("reports not running when the binary cannot be started", async () => {
    const handle = startCoturn({
      externalIp: "203.0.113.1",
      binaryPath: "/nonexistent/turnserver",
      logger,
    });
    await vi.waitFor(() => expect(handle.running()).toBe(false));
  });
});
