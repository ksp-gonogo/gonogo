import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerBootstrapConfigRoutes } from "../bootstrapConfig.js";

describe("bootstrap-config route (fastify.inject)", () => {
  async function buildApp(kspHost?: string | null) {
    const app = Fastify();
    registerBootstrapConfigRoutes(app, { kspHost });
    await app.ready();
    return app;
  }

  it("returns the configured KSP host", async () => {
    const app = await buildApp("192.168.1.50");
    const res = await app.inject({ method: "GET", url: "/bootstrap-config" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ kspHost: "192.168.1.50" });
    await app.close();
  });

  it("returns null when KSP_HOST is unset (public relay deployments)", async () => {
    const app = await buildApp(undefined);
    const res = await app.inject({ method: "GET", url: "/bootstrap-config" });
    expect(res.json()).toEqual({ kspHost: null });
    await app.close();
  });

  it("normalises empty / whitespace-only values to null", async () => {
    const app = await buildApp("   ");
    const res = await app.inject({ method: "GET", url: "/bootstrap-config" });
    expect(res.json()).toEqual({ kspHost: null });
    await app.close();
  });
});
