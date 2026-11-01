import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerBootstrapConfigRoutes } from "../bootstrapConfig.js";
import type { EndpointHandle } from "../endpointManager.js";
import { EndpointSupervisor } from "../endpointSupervisor.js";
import { registerHealthRoutes } from "../healthRoutes.js";

function handle(): EndpointHandle {
  return {
    port: 47100,
    publicIp: "203.0.113.1",
    running: () => true,
    stop: async () => {},
  };
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  expect(cond()).toBe(true);
};

describe("EndpointSupervisor", () => {
  it("stays up without the endpoint when discovery fails, then retries and starts it", async () => {
    let attempts = 0;
    const fatal: string[] = [];
    const sup = new EndpointSupervisor({
      retryMs: 10,
      discover: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("offline");
        return "203.0.113.1";
      },
      start: () => handle(),
      onFatal: (r) => fatal.push(r),
    });
    await sup.begin();
    expect(sup.handle).toBeNull();
    expect(sup.pendingReason).toMatch(/PUBLIC_IP/);

    await until(() => sup.handle !== null);
    expect(sup.pendingReason).toBeNull();
    expect(attempts).toBe(3);
    expect(fatal).toEqual([]);
    await sup.stop();
  });

  it("restarts a running endpoint so it starts again with what start reads now", async () => {
    let lan = "198.51.100.5";
    const started: string[] = [];
    let stopped = 0;
    const sup = new EndpointSupervisor({
      discover: async () => "203.0.113.1",
      start: () => {
        started.push(lan);
        return {
          ...handle(),
          stop: async () => {
            stopped += 1;
          },
        };
      },
      onFatal: () => {},
    });
    await sup.begin();
    lan = "198.51.100.24";
    await sup.restart();
    expect(started).toEqual(["198.51.100.5", "198.51.100.24"]);
    expect(stopped).toBe(1);
    expect(sup.handle).not.toBeNull();
    await sup.stop();
  });

  it("does not restart an endpoint that is not running", async () => {
    let starts = 0;
    const sup = new EndpointSupervisor({
      retryMs: 60_000,
      discover: async () => {
        throw new Error("offline");
      },
      start: () => {
        starts += 1;
        return handle();
      },
      onFatal: () => {},
    });
    await sup.begin();
    await sup.restart();
    expect(starts).toBe(0);
    await sup.stop();
  });

  it("serves /bootstrap-config while the endpoint is unavailable, with /health giving the reason", async () => {
    const sup = new EndpointSupervisor({
      retryMs: 60_000,
      discover: async () => {
        throw new Error("offline");
      },
      start: () => handle(),
      onFatal: () => {},
    });
    await sup.begin();

    const app = Fastify();
    registerHealthRoutes(app, {
      getEndpoint: () => sup.handle,
      getPendingReason: () => sup.pendingReason,
      endpointExpected: true,
    });
    registerBootstrapConfigRoutes(app, { kspHost: "192.0.2.50" });
    await app.ready();

    const boot = await app.inject({ method: "GET", url: "/bootstrap-config" });
    expect(boot.statusCode).toBe(200);
    expect(boot.json()).toEqual({ kspHost: "192.0.2.50" });

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: "ok", endpoint: null });
    expect(health.json().endpointUnavailable).toMatch(/public IP/);

    await app.close();
    await sup.stop();
  });

  it("is fatal when the endpoint cannot start", async () => {
    const fatal: string[] = [];
    const sup = new EndpointSupervisor({
      discover: async () => "203.0.113.1",
      start: () => {
        throw new Error("EACCES");
      },
      onFatal: (r) => fatal.push(r),
    });
    await sup.begin();
    expect(fatal).toEqual(["endpoint could not start: EACCES"]);
    await sup.stop();
  });

  it("passes the exit callback to the endpoint so a later death is fatal", async () => {
    const fatal: string[] = [];
    let exit: ((reason: string) => void) | undefined;
    const sup = new EndpointSupervisor({
      discover: async () => "203.0.113.1",
      start: (_ip, onExit) => {
        exit = onExit;
        return handle();
      },
      onFatal: (r) => fatal.push(r),
    });
    await sup.begin();
    exit?.("exited code=1 signal=null");
    expect(fatal).toEqual(["exited code=1 signal=null"]);
    await sup.stop();
  });

  it("stops retrying once stopped", async () => {
    let attempts = 0;
    const sup = new EndpointSupervisor({
      retryMs: 5,
      discover: async () => {
        attempts += 1;
        throw new Error("offline");
      },
      start: () => handle(),
      onFatal: () => {},
    });
    await sup.begin();
    await sup.stop();
    const seen = attempts;
    await new Promise((r) => setTimeout(r, 40));
    expect(attempts).toBe(seen);
  });
});
