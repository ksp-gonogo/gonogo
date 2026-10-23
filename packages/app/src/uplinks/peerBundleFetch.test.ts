import { describe, expect, it, vi } from "vitest";
import {
  createPeerBundleFetcher,
  createPeerManifestFetcher,
} from "./peerBundleFetch";

describe("createPeerBundleFetcher", () => {
  it("forwards url + expectedHash to client.sendBundleFetch and returns its result", async () => {
    const bytes = new TextEncoder().encode("bundle bytes").buffer;
    const sendBundleFetch = vi.fn(async () => bytes as ArrayBuffer);
    const fetchBytes = createPeerBundleFetcher({
      sendBundleFetch,
      sendManifestFetch: vi.fn(),
    });

    const result = await fetchBytes(
      "https://example.test/bundle.js",
      "sha256-abc",
    );

    expect(sendBundleFetch).toHaveBeenCalledWith(
      "https://example.test/bundle.js",
      "sha256-abc",
    );
    expect(result).toBe(bytes);
  });

  it("rejects immediately (no call to the conduit) when expectedHash is missing", async () => {
    const sendBundleFetch = vi.fn(async () => new ArrayBuffer(0));
    const fetchBytes = createPeerBundleFetcher({
      sendBundleFetch,
      sendManifestFetch: vi.fn(),
    });

    await expect(fetchBytes("https://example.test/bundle.js")).rejects.toThrow(
      /no expectedHash/,
    );
    expect(sendBundleFetch).not.toHaveBeenCalled();
  });

  it("rejects on an empty-string expectedHash the same way as missing", async () => {
    const sendBundleFetch = vi.fn(async () => new ArrayBuffer(0));
    const fetchBytes = createPeerBundleFetcher({
      sendBundleFetch,
      sendManifestFetch: vi.fn(),
    });

    await expect(
      fetchBytes("https://example.test/bundle.js", ""),
    ).rejects.toThrow(/no expectedHash/);
    expect(sendBundleFetch).not.toHaveBeenCalled();
  });

  it("propagates a rejection from the underlying conduit call (e.g. hash mismatch)", async () => {
    const sendBundleFetch = vi.fn(async () => {
      throw new Error("bundle hash mismatch");
    });
    const fetchBytes = createPeerBundleFetcher({
      sendBundleFetch,
      sendManifestFetch: vi.fn(),
    });

    await expect(
      fetchBytes("https://example.test/bundle.js", "sha256-abc"),
    ).rejects.toThrow(/bundle hash mismatch/);
  });
});

describe("createPeerManifestFetcher", () => {
  it("forwards the manifest url to client.sendManifestFetch and returns the document", async () => {
    const manifest = { id: "third", version: "1.0.0" };
    const sendManifestFetch = vi.fn(async () => manifest);
    const fetchManifest = createPeerManifestFetcher({
      sendBundleFetch: vi.fn(),
      sendManifestFetch,
    });

    await expect(
      fetchManifest("http://builder.example.test:8099/gonogo-uplink.json"),
    ).resolves.toBe(manifest);
    expect(sendManifestFetch).toHaveBeenCalledWith(
      "http://builder.example.test:8099/gonogo-uplink.json",
    );
  });
});
