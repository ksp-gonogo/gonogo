import { getDataSource } from "@ksp-gonogo/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getSitrepHostConfig,
  getSitrepReconnectNonce,
  reportSitrepTransportStatus,
  resetSitrepRuntimeForTests,
} from "../telemetry/sitrepRuntime";
import { sitrepStreamSource } from "./sitrep";

beforeEach(() => {
  localStorage.clear();
  resetSitrepRuntimeForTests();
});

describe("SitrepStreamDataSource", () => {
  it("registers itself under id 'sitrep'", () => {
    expect(getDataSource("sitrep")).toBeDefined();
  });

  it("status mirrors the shared transport-status bus", () => {
    const source = getDataSource("sitrep");
    expect(source).toBeDefined();
    if (!source) return;

    expect(source.status).toBe("disconnected");
    reportSitrepTransportStatus("connected");
    expect(source.status).toBe("connected");
  });

  it("getConfig/configure round-trip through sitrepRuntime's host config", () => {
    const source = getDataSource("sitrep");
    expect(source).toBeDefined();
    if (!source) return;

    expect(source.getConfig()).toEqual({ host: "localhost", port: 8090 });

    source.configure({ host: "192.168.1.50", port: 9000 });
    expect(source.getConfig()).toEqual({ host: "192.168.1.50", port: 9000 });
    expect(getSitrepHostConfig()).toEqual({ host: "192.168.1.50", port: 9000 });
  });

  it("configure() falls back to the current value for a blank/invalid field", () => {
    const source = getDataSource("sitrep");
    expect(source).toBeDefined();
    if (!source) return;

    source.configure({ host: "192.168.1.50", port: 9000 });
    source.configure({ host: "", port: Number.NaN });
    expect(source.getConfig()).toEqual({ host: "192.168.1.50", port: 9000 });
  });

  it("connect() only bumps the reconnect nonce once the stream has actually given up", async () => {
    const source = getDataSource("sitrep");
    expect(source).toBeDefined();
    if (!source) return;

    reportSitrepTransportStatus("connected");
    await source.connect();
    const nonceAfterHealthyConnect = getSitrepReconnectNonce();

    reportSitrepTransportStatus("disconnected");
    await source.connect();
    expect(getSitrepReconnectNonce()).toBe(nonceAfterHealthyConnect + 1);
  });

  it("schema() and subscribe() are inert — no topics route through this id", () => {
    const source = getDataSource("sitrep");
    expect(source).toBeDefined();
    if (!source) return;

    expect(source.schema()).toEqual([]);
    const unsub = source.subscribe("anything", () => {});
    expect(() => unsub()).not.toThrow();
  });

  it("execute() rejects — no actions exposed here", async () => {
    const source = getDataSource("sitrep");
    expect(source).toBeDefined();
    if (!source) return;

    await expect(source.execute("whatever")).rejects.toThrow();
  });

  it("never leaks the 'Sitrep' codename onto user-visible copy", () => {
    expect(sitrepStreamSource.name).not.toMatch(/sitrep/i);
    expect(sitrepStreamSource.setupInstructions()).not.toMatch(/sitrep/i);
  });
});
