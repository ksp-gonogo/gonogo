import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerBootstrapConfigRoutes } from "../bootstrapConfig.js";
import type { CoturnHandle } from "../coturnManager.js";
import { registerTurnRoutes } from "../turnRoutes.js";
import { TurnSupervisor } from "../turnSupervisor.js";

function handle(): CoturnHandle {
  return {
    username: "gonogo",
    credential: "s3cret",
    externalIp: "203.0.113.1",
    port: 3478,
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

describe("TurnSupervisor", () => {
  it("stays up without TURN when discovery fails, then retries and starts coturn", async () => {
    let attempts = 0;
    const fatal: string[] = [];
    const sup = new TurnSupervisor({
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
    expect(sup.pendingReason).toMatch(/TURN_EXTERNAL_IP/);

    await until(() => sup.handle !== null);
    expect(sup.pendingReason).toBeNull();
    expect(attempts).toBe(3);
    expect(fatal).toEqual([]);
    await sup.stop();
  });

  it("serves /bootstrap-config with 200 while TURN is unavailable, with /ice-config 503 giving the reason", async () => {
    const sup = new TurnSupervisor({
      retryMs: 60_000,
      discover: async () => {
        throw new Error("offline");
      },
      start: () => handle(),
      onFatal: () => {},
    });
    await sup.begin();

    const app = Fastify();
    registerTurnRoutes(app, {
      getCoturn: () => sup.handle,
      getPendingReason: () => sup.pendingReason,
      turnExpected: true,
    });
    registerBootstrapConfigRoutes(app, { kspHost: "192.0.2.50" });
    await app.ready();

    const boot = await app.inject({ method: "GET", url: "/bootstrap-config" });
    expect(boot.statusCode).toBe(200);
    expect(boot.json()).toEqual({ kspHost: "192.0.2.50" });

    const ice = await app.inject({ method: "GET", url: "/ice-config" });
    expect(ice.statusCode).toBe(503);
    expect(ice.json().reason).toMatch(/public IP/);

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: "ok", turn: null });
    expect(health.json().turnUnavailable).toMatch(/public IP/);

    await app.close();
    await sup.stop();
  });

  it("is fatal when coturn cannot start", async () => {
    const fatal: string[] = [];
    const sup = new TurnSupervisor({
      discover: async () => "203.0.113.1",
      start: () => {
        throw new Error("EACCES");
      },
      onFatal: (r) => fatal.push(r),
    });
    await sup.begin();
    expect(fatal).toEqual(["coturn could not start: EACCES"]);
    await sup.stop();
  });

  it("passes the exit callback to coturn so a later death is fatal", async () => {
    const fatal: string[] = [];
    let exit: ((reason: string) => void) | undefined;
    const sup = new TurnSupervisor({
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
    const sup = new TurnSupervisor({
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
