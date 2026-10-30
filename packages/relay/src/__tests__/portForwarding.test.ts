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
const LAN = "198.51.100.20";

/** A mapper that records which router it was made for and when it starts and stops. */
function recorder() {
  const events: string[] = [];
  const make = (router: string, lan: string | null): ForwardingMapper => ({
    status: { state: "mapped", message: "opened" } as PortMappingStatus,
    start: async () => {
      events.push(lan ? `start ${router} to ${lan}` : `start ${router}`);
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
    const a = new PortForwarding(off.make, {
      enabled: false,
      router: ROUTER,
      lan: null,
    });
    await a.start();
    expect(off.events).toEqual([]);
    expect(a.status).toBeNull();

    const on = recorder();
    const b = new PortForwarding(on.make, {
      enabled: true,
      router: ROUTER,
      lan: null,
    });
    await b.start();
    expect(on.events).toEqual([`start ${ROUTER}`]);
    expect(b.status?.state).toBe("mapped");
    await b.stop();
    expect(on.events.at(-1)).toBe(`stop ${ROUTER}`);
  });

  it("asks nothing without a router address, and says it needs one", async () => {
    const r = recorder();
    const f = new PortForwarding(r.make, {
      enabled: true,
      router: null,
      lan: null,
    });
    await f.start();
    expect(r.events).toEqual([]);
    expect(f.status?.state).toBe("no-address");
  });

  it("takes an IPv6 router address and says it cannot ask it yet, asking nothing", async () => {
    const r = recorder();
    const f = new PortForwarding(r.make, {
      enabled: true,
      router: "fe80::1%eth0",
      lan: null,
    });
    await f.start();
    expect(r.events).toEqual([]);
    expect(f.status?.state).toBe("ipv6-unsupported");
    expect(f.status?.message).toMatch(/IPv6/);
  });

  it("opens and closes the port as the switch changes, in order, and moves to a new router address", async () => {
    const r = recorder();
    const f = new PortForwarding(r.make, {
      enabled: false,
      router: null,
      lan: null,
    });
    await f.start();
    await Promise.all([
      f.set({ enabled: true, router: ROUTER, lan: null }),
      f.set({ enabled: false, router: ROUTER, lan: null }),
      f.set({ enabled: true, router: ROUTER, lan: null }),
    ]);
    expect(r.events).toEqual([
      `start ${ROUTER}`,
      `stop ${ROUTER}`,
      `start ${ROUTER}`,
    ]);
    await f.set({ enabled: true, router: ROUTER, lan: null });
    expect(r.events).toHaveLength(3);
    await f.set({ enabled: true, router: OTHER_ROUTER, lan: null });
    expect(r.events.slice(3)).toEqual([
      `stop ${ROUTER}`,
      `start ${OTHER_ROUTER}`,
    ]);
    await f.stop();
  });

  it("reports a changed computer address once, and not when it is sent again unchanged", async () => {
    const r = recorder();
    const seen: Array<string | null> = [];
    const f = new PortForwarding(
      r.make,
      { enabled: true, router: ROUTER, lan: null },
      (lan) => seen.push(lan),
    );
    await f.start();
    await f.set({ enabled: true, router: ROUTER, lan: LAN });
    await f.set({ enabled: true, router: ROUTER, lan: LAN });
    await f.set({ enabled: false, router: ROUTER, lan: LAN });
    expect(seen).toEqual([LAN]);
    await f.stop();
  });

  it("takes the switch and the router address from the main screen, and reports them", async () => {
    const r = recorder();
    const f = new PortForwarding(r.make, {
      enabled: false,
      router: null,
      lan: null,
    });
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

    const v6 = await app.inject({
      method: "POST",
      url: "/port-forward",
      payload: { enabled: true, routerIp: "2001:db8::1" },
    });
    expect(v6.statusCode).toBe(200);
    expect(v6.json()).toMatchObject({
      routerIp: "2001:db8::1",
      portMapping: { state: "ipv6-unsupported" },
    });
    await app.inject({
      method: "POST",
      url: "/port-forward",
      payload: { enabled: true, routerIp: ROUTER },
    });

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

    const lan = await app.inject({
      method: "POST",
      url: "/port-forward",
      payload: { enabled: true, lanIp: LAN },
    });
    expect(lan.json()).toMatchObject({ routerIp: ROUTER, lanIp: LAN });
    expect(r.events.slice(-2)).toEqual([
      `stop ${ROUTER}`,
      `start ${ROUTER} to ${LAN}`,
    ]);
    const badLan = await app.inject({
      method: "POST",
      url: "/port-forward",
      payload: { enabled: true, lanIp: "this computer" },
    });
    expect(badLan.statusCode).toBe(400);

    const read = await app.inject({ method: "GET", url: "/port-forward" });
    expect(read.json()).toMatchObject({ enabled: true, routerIp: ROUTER });
    await app.close();
    await f.stop();
  });
});
