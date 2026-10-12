import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { CoturnHandle } from "../coturnManager.js";
import { registerTurnRoutes } from "../turnRoutes.js";

function handle(running: () => boolean): CoturnHandle {
  return {
    username: "gonogo",
    credential: "s3cret",
    externalIp: "203.0.113.1",
    port: 3478,
    running: running,
    stop: async () => {},
  };
}

async function buildApp(
  getCoturn: () => CoturnHandle | null,
  turnExpected = true,
) {
  const app = Fastify();
  registerTurnRoutes(app, { getCoturn, turnExpected });
  await app.ready();
  return app;
}

describe("turn routes (fastify.inject)", () => {
  it("serves health and credentials while coturn runs", async () => {
    const app = await buildApp(() => handle(() => true));
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({
      status: "ok",
      turn: { externalIp: "203.0.113.1", port: 3478 },
    });
    const ice = await app.inject({ method: "GET", url: "/ice-config" });
    expect(ice.statusCode).toBe(200);
    expect(ice.json().iceServers[0].credential).toBe("s3cret");
    await app.close();
  });

  it("answers 503 from both routes once coturn has died", async () => {
    let alive = true;
    const app = await buildApp(() => handle(() => alive));
    alive = false;
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(503);
    expect(health.json().status).not.toBe("ok");
    const ice = await app.inject({ method: "GET", url: "/ice-config" });
    expect(ice.statusCode).toBe(503);
    expect(ice.body).not.toContain("s3cret");
    await app.close();
  });

  it("answers 503 when coturn was expected but never started", async () => {
    const app = await buildApp(() => null);
    expect(
      (await app.inject({ method: "GET", url: "/health" })).statusCode,
    ).toBe(503);
    expect(
      (await app.inject({ method: "GET", url: "/ice-config" })).statusCode,
    ).toBe(503);
    await app.close();
  });

  it("reports a retrying TURN as a healthy relay with the reason", async () => {
    const app = Fastify();
    registerTurnRoutes(app, {
      getCoturn: () => null,
      getPendingReason: () => "public IP not discovered",
      turnExpected: true,
    });
    await app.ready();
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json().turnUnavailable).toBe("public IP not discovered");
    await app.close();
  });

  it("reports health ok with no TURN when coturn is deliberately skipped", async () => {
    const app = await buildApp(() => null, false);
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok", turn: null });
    expect(
      (await app.inject({ method: "GET", url: "/ice-config" })).statusCode,
    ).toBe(503);
    await app.close();
  });
});
