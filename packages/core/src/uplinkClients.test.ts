import { clearProcessors, getProcessor } from "@ksp-gonogo/sitrep-client";
import { beforeEach, describe, expect, it } from "vitest";
import { clearContributions, getContributionsForSlot } from "./contributions";
import {
  CORE_UPLINK_CLIENT,
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

  it("returns a frozen handle carrying exactly the declared fields plus bound registerContribution/registerProcessor", () => {
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
      registerContribution: expect.any(Function),
      registerProcessor: expect.any(Function),
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

describe("UplinkClientHandle.registerContribution", () => {
  beforeEach(() => {
    clearContributions();
    clearUplinkClients();
  });

  it("stamps the registered contribution's id with the client's own id and sets owner to the handle", () => {
    const client = defineUplinkClient({
      id: "example-uplink",
      version: "1.0.0",
      name: "Example",
    });

    client.registerContribution({
      id: "my-widget",
      contributes: "test.slot",
      compute: () => [{ id: "row" }],
    });

    const [registered] = getContributionsForSlot("test.slot");
    expect(registered.id).toBe("example-uplink:my-widget");
    expect(registered.owner).toBe(client);
  });

  it("throws when two different clients' contributions collide on the STAMPED id (never possible: ids are auto-namespaced)", () => {
    const clientA = defineUplinkClient({
      id: "a",
      version: "1.0.0",
      name: "A",
    });
    const clientB = defineUplinkClient({
      id: "b",
      version: "1.0.0",
      name: "B",
    });
    clientA.registerContribution({
      id: "shared-local-id",
      contributes: "test.slot",
      compute: () => null,
    });
    // Different owner namespace, so this does NOT collide; proves the
    // auto-namespacing actually prevents cross-Uplink collision by
    // construction rather than merely reducing its likelihood.
    expect(() =>
      clientB.registerContribution({
        id: "shared-local-id",
        contributes: "test.slot",
        compute: () => null,
      }),
    ).not.toThrow();
  });
});

describe("CORE_UPLINK_CLIENT", () => {
  it('is a reserved handle with id "core" for built-in registrations', () => {
    expect(CORE_UPLINK_CLIENT.id).toBe("core");
  });
});

describe("UplinkClientHandle.registerProcessor", () => {
  beforeEach(() => clearProcessors());

  it("stamps the processor's owner with the client's own id", () => {
    const client = defineUplinkClient({
      id: "example-uplink",
      version: "1.0.0",
      name: "Example",
    });

    const handle = client.registerProcessor({
      id: "fuel-level",
      deps: [] as const,
      compute: () => 42,
    });

    expect(handle.id).toBe("example-uplink:fuel-level");
    expect(getProcessor(handle.id)?.owner).toBe("example-uplink");
  });
});
