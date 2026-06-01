import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  HOST_TTL_MS,
  HostRegistry,
  registerHostRoutes,
} from "../hostRegistry.js";

describe("HostRegistry", () => {
  it("resolves a registered share code to its peer id", () => {
    const reg = new HostRegistry();
    reg.register("AB3K", "peer-123");
    expect(reg.resolve("AB3K")).toBe("peer-123");
  });

  it("returns null for an unknown share code", () => {
    const reg = new HostRegistry();
    expect(reg.resolve("NOPE")).toBeNull();
  });

  it("a re-register overwrites the previous peer id (host rotation)", () => {
    const reg = new HostRegistry();
    reg.register("AB3K", "peer-old");
    reg.register("AB3K", "peer-new");
    expect(reg.resolve("AB3K")).toBe("peer-new");
  });

  it("expires an entry once its TTL passes", () => {
    const reg = new HostRegistry(1_000);
    reg.register("AB3K", "peer-123", 0);
    // Just before expiry — still resolvable.
    expect(reg.resolve("AB3K", 999)).toBe("peer-123");
    // At/after expiry — gone.
    expect(reg.resolve("AB3K", 1_000)).toBeNull();
  });

  it("a heartbeat re-register pushes the expiry forward", () => {
    const reg = new HostRegistry(1_000);
    reg.register("AB3K", "peer-123", 0);
    // Heartbeat at t=800 resets the 1s window.
    reg.register("AB3K", "peer-123", 800);
    // Original window would have expired at 1000; the heartbeat keeps it.
    expect(reg.resolve("AB3K", 1_500)).toBe("peer-123");
    expect(reg.resolve("AB3K", 1_800)).toBeNull();
  });

  it("sweep drops expired entries and leaves live ones", () => {
    const reg = new HostRegistry(1_000);
    reg.register("OLD", "peer-old", 0);
    reg.register("NEW", "peer-new", 500);
    expect(reg.size).toBe(2);
    reg.sweep(1_000); // OLD expired, NEW (expires 1500) survives
    expect(reg.size).toBe(1);
    expect(reg.resolve("NEW", 1_000)).toBe("peer-new");
  });

  it("the default TTL is the documented 90s", () => {
    expect(HOST_TTL_MS).toBe(90_000);
  });
});

describe("host-discovery routes (fastify.inject)", () => {
  async function buildApp() {
    const app = Fastify();
    const registry = registerHostRoutes(app);
    await app.ready();
    return { app, registry };
  }

  it("POST /host registers then GET /host/:code resolves", async () => {
    const { app } = await buildApp();
    const post = await app.inject({
      method: "POST",
      url: "/host",
      payload: { shareCode: "AB3K", peerId: "peer-123" },
    });
    expect(post.statusCode).toBe(200);

    const get = await app.inject({ method: "GET", url: "/host/AB3K" });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual({ peerId: "peer-123" });
    await app.close();
  });

  it("GET /host/:code returns 404 for an unknown code", async () => {
    const { app } = await buildApp();
    const get = await app.inject({ method: "GET", url: "/host/UNKNOWN" });
    expect(get.statusCode).toBe(404);
    await app.close();
  });

  it("GET /host/:code returns 404 once the entry has expired", async () => {
    const app = Fastify();
    // 0ms TTL — every entry is already expired by the time it's resolved.
    registerHostRoutes(app, new HostRegistry(0));
    await app.ready();

    await app.inject({
      method: "POST",
      url: "/host",
      payload: { shareCode: "AB3K", peerId: "peer-123" },
    });
    const get = await app.inject({ method: "GET", url: "/host/AB3K" });
    expect(get.statusCode).toBe(404);
    await app.close();
  });

  it("a re-POST under the same code reflects the new peer id (rotation)", async () => {
    const { app } = await buildApp();
    await app.inject({
      method: "POST",
      url: "/host",
      payload: { shareCode: "AB3K", peerId: "peer-old" },
    });
    await app.inject({
      method: "POST",
      url: "/host",
      payload: { shareCode: "AB3K", peerId: "peer-new" },
    });
    const get = await app.inject({ method: "GET", url: "/host/AB3K" });
    expect(get.json()).toEqual({ peerId: "peer-new" });
    await app.close();
  });

  it("POST /host rejects a body missing shareCode or peerId with 400", async () => {
    const { app } = await buildApp();
    const noPeer = await app.inject({
      method: "POST",
      url: "/host",
      payload: { shareCode: "AB3K" },
    });
    expect(noPeer.statusCode).toBe(400);
    const noCode = await app.inject({
      method: "POST",
      url: "/host",
      payload: { peerId: "peer-123" },
    });
    expect(noCode.statusCode).toBe(400);
    await app.close();
  });
});
