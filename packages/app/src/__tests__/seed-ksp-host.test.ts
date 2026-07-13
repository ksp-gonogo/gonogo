import {
  getGameHost,
  resetSettingsForTests,
  setSetting,
} from "@ksp-gonogo/core";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { seedKspHostDefaults } from "../dataSources/seedKspHost";

const BOOTSTRAP_URL = "http://localhost:3002/bootstrap-config";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  server.resetHandlers();
  resetSettingsForTests();
  localStorage.clear();
});
afterAll(() => server.close());

function bootstrapHandler(kspHost: string | null) {
  return http.get(BOOTSTRAP_URL, () => HttpResponse.json({ kspHost }));
}

describe("seedKspHostDefaults", () => {
  it("seeds the shared gameHost from a LAN KSP_HOST", async () => {
    server.use(bootstrapHandler("192.168.1.50"));
    await seedKspHostDefaults();
    expect(getGameHost()).toBe("192.168.1.50");
    // in-memory seed only — nothing persisted
    expect(localStorage.getItem("gonogo.settings")).toBeNull();
  });

  it("maps container-internal hosts to localhost", async () => {
    server.use(bootstrapHandler("host.docker.internal"));
    await seedKspHostDefaults();
    expect(getGameHost()).toBe("localhost");
  });

  it("never overrides a user-saved gameHost", async () => {
    setSetting("gameHost", "my-ksp-box");
    server.use(bootstrapHandler("192.168.1.50"));
    await seedKspHostDefaults();
    expect(getGameHost()).toBe("my-ksp-box");
  });

  it("is a no-op when the relay reports no KSP_HOST", async () => {
    server.use(bootstrapHandler(null));
    await seedKspHostDefaults();
    expect(getGameHost()).toBe("localhost");
  });

  it("is a no-op when no relay is reachable", async () => {
    server.use(http.get(BOOTSTRAP_URL, () => HttpResponse.error()));
    await seedKspHostDefaults();
    expect(getGameHost()).toBe("localhost");
  });
});
