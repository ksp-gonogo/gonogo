import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { EndpointHandle } from "../endpointManager.js";
import { registerHealthRoutes } from "../healthRoutes.js";

function handle(running = true): EndpointHandle {
  return {
    port: 47100,
    publicIp: "203.0.113.7",
    running: () => running,
    stop: async () => {},
  };
}

async function health(opts: Parameters<typeof registerHealthRoutes>[1]) {
  const app = Fastify();
  registerHealthRoutes(app, opts);
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/health" });
  await app.close();
  return { status: res.statusCode, body: res.json() };
}

describe("/health", () => {
  it("names the endpoint's port and public address while it runs", async () => {
    expect(
      await health({ getEndpoint: () => handle(), endpointExpected: true }),
    ).toEqual({
      status: 200,
      body: {
        status: "ok",
        endpoint: { port: 47100, publicIp: "203.0.113.7" },
      },
    });
  });

  it("stays healthy and says why while the endpoint waits for a public address", async () => {
    const res = await health({
      getEndpoint: () => null,
      getPendingReason: () => "public IP not discovered",
      endpointExpected: true,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ok",
      endpoint: null,
      endpointUnavailable: "public IP not discovered",
    });
  });

  it("fails when the endpoint should be running and is not", async () => {
    const res = await health({
      getEndpoint: () => handle(false),
      endpointExpected: true,
    });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "endpoint-down", endpoint: null });
  });

  it("is healthy with no endpoint on a relay started without one", async () => {
    expect(
      await health({ getEndpoint: () => null, endpointExpected: false }),
    ).toEqual({ status: 200, body: { status: "ok", endpoint: null } });
  });

  it("carries where the router forward stands", async () => {
    const res = await health({
      getEndpoint: () => handle(),
      endpointExpected: true,
      getPortMapping: () => ({ state: "refused", message: "refused" }),
    });
    expect(res.body.portMapping).toEqual({
      state: "refused",
      message: "refused",
    });
  });
});
