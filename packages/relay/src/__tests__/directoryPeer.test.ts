import { describe, expect, it } from "vitest";
import {
  DIRECTORY_PEER_PREFIX,
  directoryPeerOptionsFromEnv,
  resolveReply,
} from "../directoryPeer.js";
import { HostRegistry } from "../hostRegistry.js";

describe("resolveReply (directory resolve handler)", () => {
  it("replies { type: 'host', peerId } for a registered code", () => {
    const reg = new HostRegistry();
    reg.register("AB3K", "peer-123");
    expect(resolveReply(reg, "AB3K", { type: "resolve" })).toEqual({
      type: "host",
      peerId: "peer-123",
    });
  });

  it("replies { type: 'not-found' } for an unknown code", () => {
    const reg = new HostRegistry();
    expect(resolveReply(reg, "NOPE", { type: "resolve" })).toEqual({
      type: "not-found",
    });
  });

  it("replies { type: 'not-found' } for an expired entry", () => {
    const reg = new HostRegistry(0); // 0ms TTL
    reg.register("AB3K", "peer-123");
    expect(resolveReply(reg, "AB3K", { type: "resolve" })).toEqual({
      type: "not-found",
    });
  });

  it("reflects a host rotation — re-register then resolve gets the new id", () => {
    const reg = new HostRegistry();
    reg.register("AB3K", "peer-old");
    reg.register("AB3K", "peer-new");
    expect(resolveReply(reg, "AB3K", { type: "resolve" })).toEqual({
      type: "host",
      peerId: "peer-new",
    });
  });

  it("ignores a malformed request (wrong/absent type) with not-found", () => {
    const reg = new HostRegistry();
    reg.register("AB3K", "peer-123");
    expect(resolveReply(reg, "AB3K", { type: "wrong" })).toEqual({
      type: "not-found",
    });
    expect(resolveReply(reg, "AB3K", undefined)).toEqual({
      type: "not-found",
    });
    expect(resolveReply(reg, "AB3K", null)).toEqual({ type: "not-found" });
  });
});

describe("directoryPeerOptionsFromEnv", () => {
  it("defaults to the public broker namespace (key 'gonogo') with no PEER_* set", () => {
    expect(directoryPeerOptionsFromEnv({})).toEqual({ key: "gonogo" });
  });

  it("mirrors the app's PEER_* env names", () => {
    expect(
      directoryPeerOptionsFromEnv({
        PEER_HOST: "localhost",
        PEER_PORT: "9999",
        PEER_PATH: "/myapp",
        PEER_KEY: "custom",
        PEER_SECURE: "0",
      }),
    ).toEqual({
      key: "custom",
      host: "localhost",
      port: 9999,
      path: "/myapp",
      secure: false,
    });
  });

  it("treats PEER_SECURE other than 0/false as secure", () => {
    expect(directoryPeerOptionsFromEnv({ PEER_SECURE: "true" }).secure).toBe(
      true,
    );
    expect(directoryPeerOptionsFromEnv({ PEER_SECURE: "1" }).secure).toBe(true);
    expect(directoryPeerOptionsFromEnv({ PEER_SECURE: "false" }).secure).toBe(
      false,
    );
  });

  it("ignores a non-numeric PEER_PORT", () => {
    expect(directoryPeerOptionsFromEnv({ PEER_PORT: "nope" }).port).toBe(
      undefined,
    );
  });
});

describe("DIRECTORY_PEER_PREFIX", () => {
  it("matches the app's directoryProtocol prefix", () => {
    // The app mirrors this constant in packages/app/src/peer/directoryProtocol.ts.
    // Keeping the literal here as a tripwire if either side drifts.
    expect(DIRECTORY_PEER_PREFIX).toBe("gonogo-dir-");
  });
});
