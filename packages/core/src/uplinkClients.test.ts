import { beforeEach, describe, expect, it } from "vitest";
import {
  clearUplinkClients,
  defineUplinkClient,
  getUplinkClients,
} from "./uplinkClients";

beforeEach(() => {
  clearUplinkClients();
});

describe("defineUplinkClient / getUplinkClients / clearUplinkClients", () => {
  it("registers an enumerable client handle", () => {
    const handle = defineUplinkClient({
      id: "mod-alpha",
      version: "0.0.0-dev",
      name: "Mod Alpha",
    });

    expect(getUplinkClients()).toContainEqual(handle);
  });

  it("returns a frozen handle carrying exactly the declared fields", () => {
    const handle = defineUplinkClient({
      id: "mod-beta",
      version: "1.2.3",
      name: "Mod Beta",
    });

    expect(Object.isFrozen(handle)).toBe(true);
    expect(handle).toEqual({
      id: "mod-beta",
      version: "1.2.3",
      name: "Mod Beta",
    });
  });

  it("last-write-wins on re-declaring the same id (HMR/static-import-friendly)", () => {
    const first = defineUplinkClient({
      id: "mod-alpha",
      version: "0.0.0-dev",
      name: "Mod Alpha",
    });
    const second = defineUplinkClient({
      id: "mod-alpha",
      version: "0.0.1-dev",
      name: "Mod Alpha",
    });

    const clients = getUplinkClients();
    expect(clients).toHaveLength(1);
    expect(clients[0]).toBe(second);
    expect(clients[0]).not.toBe(first);
  });

  it("clearUplinkClients empties the registry", () => {
    defineUplinkClient({ id: "mod-alpha", version: "0.0.0-dev", name: "A" });
    defineUplinkClient({ id: "mod-beta", version: "0.0.0-dev", name: "B" });

    clearUplinkClients();

    expect(getUplinkClients()).toEqual([]);
  });
});
