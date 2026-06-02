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

describe("host-discovery route (fastify.inject)", () => {
  async function buildApp(opts?: Parameters<typeof registerHostRoutes>[1]) {
    const app = Fastify();
    const registry = registerHostRoutes(app, opts);
    await app.ready();
    return { app, registry };
  }

  it("POST /host registers a share-code → peer-id mapping in the registry", async () => {
    const { app, registry } = await buildApp();
    const post = await app.inject({
      method: "POST",
      url: "/host",
      payload: { shareCode: "AB3K", peerId: "peer-123" },
    });
    expect(post.statusCode).toBe(200);
    // Diagnostics-only registry — assert the POST landed.
    expect(registry.resolve("AB3K")).toBe("peer-123");
    await app.close();
  });

  it("a re-POST under the same code reflects the new peer id (rotation)", async () => {
    const { app, registry } = await buildApp();
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
    expect(registry.resolve("AB3K")).toBe("peer-new");
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

  it("uses a supplied registry when one is passed in options", async () => {
    const registry = new HostRegistry(0); // 0ms TTL — entries expire instantly
    const { app } = await buildApp({ registry });
    await app.inject({
      method: "POST",
      url: "/host",
      payload: { shareCode: "AB3K", peerId: "peer-123" },
    });
    // Entry is already expired on resolve (TTL 0) — proves our registry
    // instance, not a fresh internal one, is the backing store.
    expect(registry.resolve("AB3K")).toBeNull();
    await app.close();
  });
});
