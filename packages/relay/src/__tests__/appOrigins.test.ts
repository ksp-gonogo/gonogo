import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerAnalyticsConfigRoutes } from "../analyticsConfig.js";
import { isAppOrigin, registerAppOrigins } from "../appOrigins.js";

describe("isAppOrigin", () => {
  it("serves the public build and loopback pages at any port", () => {
    expect(isAppOrigin("https://ksp-gonogo.github.io")).toBe(true);
    expect(isAppOrigin("http://localhost:8080")).toBe(true);
    expect(isAppOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(isAppOrigin("http://[::1]:4173")).toBe(true);
  });

  it("refuses any other page", () => {
    expect(isAppOrigin("https://evil.example")).toBe(false);
    expect(isAppOrigin("http://198.51.100.20:8080")).toBe(false);
    expect(isAppOrigin("http://localhost.evil.example")).toBe(false);
    expect(isAppOrigin("https://ksp-gonogo.github.io.evil.example")).toBe(
      false,
    );
    expect(isAppOrigin("null")).toBe(false);
  });

  it("serves a page from the host the request was addressed to, at any port", () => {
    expect(
      isAppOrigin("http://198.51.100.20:8080", new Set(), "198.51.100.20:3002"),
    ).toBe(true);
    expect(
      isAppOrigin("http://198.51.100.21:8080", new Set(), "198.51.100.20:3002"),
    ).toBe(false);
  });

  it("refuses a named page addressing the relay by its own name, as a rebound domain does", () => {
    expect(
      isAppOrigin("http://evil.example:3002", new Set(), "evil.example:3002"),
    ).toBe(false);
  });

  it("serves an origin the operator added", () => {
    const extra = new Set(["http://198.51.100.20:8080"]);
    expect(isAppOrigin("http://198.51.100.20:8080", extra)).toBe(true);
  });
});

describe("registerAppOrigins", () => {
  async function buildApp() {
    const app = Fastify();
    await registerAppOrigins(app, new Set());
    const controller = registerAnalyticsConfigRoutes(app);
    await app.ready();
    return { app, controller };
  }

  it("refuses a consent change from a foreign page and leaves the value alone", async () => {
    const { app, controller } = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/analytics-config",
      headers: { origin: "https://evil.example" },
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(403);
    expect(controller.get()).toBe(false);
    await app.close();
  });

  it("gives a foreign page no CORS grant on a preflight", async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: "OPTIONS",
      url: "/analytics-config",
      headers: {
        origin: "https://evil.example",
        "access-control-request-method": "POST",
      },
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });

  it("serves the app's own page with a CORS grant naming it", async () => {
    const { app, controller } = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/analytics-config",
      headers: { origin: "http://localhost:8080" },
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "http://localhost:8080",
    );
    expect(controller.get()).toBe(true);
    await app.close();
  });

  it("serves a main screen opened at the relay machine's LAN address", async () => {
    const { app } = await buildApp();
    const lan = await app.inject({
      method: "GET",
      url: "/analytics-config",
      headers: {
        origin: "http://198.51.100.20:8080",
        host: "198.51.100.20:3002",
      },
    });
    expect(lan.statusCode).toBe(200);
    expect(lan.headers["access-control-allow-origin"]).toBe(
      "http://198.51.100.20:8080",
    );
    const foreign = await app.inject({
      method: "GET",
      url: "/analytics-config",
      headers: { origin: "https://evil.example", host: "198.51.100.20:3002" },
    });
    expect(foreign.statusCode).toBe(403);
    await app.close();
  });

  it("serves a request with no origin, as from curl on this machine", async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: "GET", url: "/analytics-config" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
