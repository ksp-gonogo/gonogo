import { describe, expect, it } from "vitest";
import {
  getUplinkHandle,
  registerUplinkHandle,
  unregisterUplinkHandle,
} from "./uplinkHandles";

describe("uplinkHandles", () => {
  it("registers a handle and looks it up by id", () => {
    const handle = { foo: "bar" };
    registerUplinkHandle("test-register-lookup", handle);

    expect(getUplinkHandle("test-register-lookup")).toBe(handle);
  });

  it("replaces the previous handle when registering the same id again", () => {
    const first = { version: 1 };
    const second = { version: 2 };
    registerUplinkHandle("test-overwrite", first);
    registerUplinkHandle("test-overwrite", second);

    expect(getUplinkHandle("test-overwrite")).toBe(second);
  });

  it("returns undefined for an id that was never registered", () => {
    expect(getUplinkHandle("test-never-registered")).toBeUndefined();
  });

  it("removes a handle on unregister so lookup returns undefined", () => {
    registerUplinkHandle("test-unregister", { foo: "bar" });
    unregisterUplinkHandle("test-unregister");

    expect(getUplinkHandle("test-unregister")).toBeUndefined();
  });
});
