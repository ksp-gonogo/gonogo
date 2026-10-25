import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  type ForwardingMapper,
  PortForwarding,
  registerPortForwardRoutes,
} from "../portForwarding.js";
import type { PortMappingStatus } from "../portMapper.js";

/** A mapper that records being started and stopped, standing in for the router. */
function recorder() {
  const events: string[] = [];
  let n = 0;
  const make = (): ForwardingMapper => {
    const id = ++n;
    return {
      status: { state: "mapped", message: "opened" } as PortMappingStatus,
      start: async () => {
        events.push(`start ${id}`);
      },
      stop: async () => {
        events.push(`stop ${id}`);
      },
    };
  };
  return { events, make };
}

describe("automatic port forwarding", () => {
  it("opens the port at start only when it starts switched on", async () => {
    const off = recorder();
    const a = new PortForwarding(off.make, false);
    await a.start();
    expect(off.events).toEqual([]);
    expect(a.status).toBeNull();

    const on = recorder();
    const b = new PortForwarding(on.make, true);
    await b.start();
    expect(on.events).toEqual(["start 1"]);
    expect(b.status?.state).toBe("mapped");
    await b.stop();
    expect(on.events).toEqual(["start 1", "stop 1"]);
  });

  it("opens and closes the port as the switch changes, in order", async () => {
    const r = recorder();
    const f = new PortForwarding(r.make, false);
    await f.start();
    await Promise.all([f.set(true), f.set(false), f.set(true)]);
    expect(r.events).toEqual(["start 1", "stop 1", "start 2"]);
    expect(f.enabled).toBe(true);
    await f.set(true);
    expect(r.events).toHaveLength(3);
    await f.stop();
    expect(r.events.at(-1)).toBe("stop 2");
  });

  it("takes the switch from the main screen, and reports it", async () => {
    const r = recorder();
    const f = new PortForwarding(r.make, false);
    const app = Fastify();
    registerPortForwardRoutes(app, f);
    await app.ready();

    const on = await app.inject({
      method: "POST",
      url: "/port-forward",
      payload: { enabled: true },
    });
    expect(on.statusCode).toBe(200);
    expect(on.json()).toMatchObject({
      enabled: true,
      portMapping: { state: "mapped" },
    });
    expect(r.events).toEqual(["start 1"]);

    const bad = await app.inject({
      method: "POST",
      url: "/port-forward",
      payload: { enabled: "yes" },
    });
    expect(bad.statusCode).toBe(400);

    const read = await app.inject({ method: "GET", url: "/port-forward" });
    expect(read.json()).toMatchObject({ enabled: true });
    await app.close();
    await f.stop();
  });
});
