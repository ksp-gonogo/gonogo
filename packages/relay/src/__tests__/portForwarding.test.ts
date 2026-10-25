import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  type ForwardingMapper,
  PortForwarding,
  registerPortForwardRoutes,
} from "../portForwarding.js";
import type { PortMappingStatus } from "../portMapper.js";

const ROUTER = "198.51.100.1";
const OTHER_ROUTER = "198.51.100.254";

/** A mapper that records which router it was made for and when it starts and stops. */
function recorder() {
  const events: string[] = [];
  const make = (router: string): ForwardingMapper => ({
    status: { state: "mapped", message: "opened" } as PortMappingStatus,
    start: async () => {
      events.push(`start ${router}`);
    },
    stop: async () => {
      events.push(`stop ${router}`);
    },
  });
  return { events, make };
}

describe("automatic port forwarding", () => {
  it("opens the port at start only when it starts on with a router address", async () => {
    const off = recorder();
    const a = new PortForwarding(off.make, { enabled: false, router: ROUTER });
    await a.start();
    expect(off.events).toEqual([]);
    expect(a.status).toBeNull();

    const on = recorder();
    const b = new PortForwarding(on.make, { enabled: true, router: ROUTER });
    await b.start();
    expect(on.events).toEqual([`start ${ROUTER}`]);
    expect(b.status?.state).toBe("mapped");
    await b.stop();
    expect(on.events.at(-1)).toBe(`stop ${ROUTER}`);
  });

  it("asks nothing without a router address, and says it needs one", async () => {
    const r = recorder();
    const f = new PortForwarding(r.make, { enabled: true, router: null });
    await f.start();
    expect(r.events).toEqual([]);
    expect(f.status?.state).toBe("no-address");
  });

  it("opens and closes the port as the switch changes, in order, and moves to a new router address", async () => {
    const r = recorder();
    const f = new PortForwarding(r.make, { enabled: false, router: null });
    await f.start();
    await Promise.all([
      f.set({ enabled: true, router: ROUTER }),
      f.set({ enabled: false, router: ROUTER }),
      f.set({ enabled: true, router: ROUTER }),
    ]);
    expect(r.events).toEqual([
      `start ${ROUTER}`,
      `stop ${ROUTER}`,
      `start ${ROUTER}`,
    ]);
    await f.set({ enabled: true, router: ROUTER });
    expect(r.events).toHaveLength(3);
    await f.set({ enabled: true, router: OTHER_ROUTER });
    expect(r.events.slice(3)).toEqual([
      `stop ${ROUTER}`,
      `start ${OTHER_ROUTER}`,
    ]);
    await f.stop();
  });

  it("takes the switch and the router address from the main screen, and reports them", async () => {
    const r = recorder();
    const f = new PortForwarding(r.make, { enabled: false, router: null });
    const app = Fastify();
    registerPortForwardRoutes(app, f);
    await app.ready();

    const on = await app.inject({
      method: "POST",
      url: "/port-forward",
      payload: { enabled: true, routerIp: ROUTER },
    });
    expect(on.statusCode).toBe(200);
    expect(on.json()).toMatchObject({
      enabled: true,
      routerIp: ROUTER,
      portMapping: { state: "mapped" },
    });
    expect(r.events).toEqual([`start ${ROUTER}`]);

    for (const payload of [
      { enabled: "yes" },
      { enabled: true, routerIp: "my router" },
      { enabled: true, routerIp: "300.1.1.1" },
    ]) {
      const bad = await app.inject({
        method: "POST",
        url: "/port-forward",
        payload,
      });
      expect(bad.statusCode).toBe(400);
    }

    const keep = await app.inject({
      method: "POST",
      url: "/port-forward",
      payload: { enabled: true },
    });
    expect(keep.json()).toMatchObject({ routerIp: ROUTER });

    const read = await app.inject({ method: "GET", url: "/port-forward" });
    expect(read.json()).toMatchObject({ enabled: true, routerIp: ROUTER });
    await app.close();
    await f.stop();
  });
});
