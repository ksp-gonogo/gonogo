/**
 * Integration proof that the main screen's kOS CPU registry populates purely
 * from a `kos.processors` frame on the sitrep stream — the discovery path that
 * replaced the old telnet menu-peek.
 *
 * Nothing internal is mocked: the REAL `KosCpuDiscovery` component adopts the
 * live `TelemetryClient` into the REAL `kosSource` (its Uplink executor stands
 * up the standing `kos.processors` subscription), the REAL
 * `KosDataSource.onProcessorsChanged` feed is wired to a REAL
 * `CpuRegistryService` exactly as `MainScreen` wires it, and a REAL
 * `TelemetryProvider` supplies the client. Only the wire is faked, via
 * `FakeKosUplink` (a `StubTransport`-backed `kos.processors`/`kos.run`
 * responder — the same fixture the executeScript integration tests use).
 */

import { getDataSource } from "@ksp-gonogo/core";
import { CpuRegistryService } from "@ksp-gonogo/kos";
import { TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import { render, waitFor } from "@ksp-gonogo/test-utils";
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { KosCpuDiscovery } from "../dataSources/KosCpuDiscovery";
import { KosDataSource, kosSource } from "../dataSources/kos";
import { FakeKosUplink } from "./fixtures/FakeKosUplink";

/**
 * The exact registry wiring `MainScreen` mounts: subscribe `kos.processors`
 * changes into `cpuRegistry.reportOnline(procs.map(p => p.tag))`.
 */
function CpuRegistryBridge({ registry }: { registry: CpuRegistryService }) {
  useEffect(() => {
    const kos = getDataSource("kos");
    if (!(kos instanceof KosDataSource)) return;
    return kos.onProcessorsChanged((procs) => {
      registry.reportOnline(
        procs.map((p) => p.tag).filter((tag): tag is string => Boolean(tag)),
      );
    });
  }, [registry]);
  return null;
}

describe("kOS CPU discovery → registry", () => {
  afterEach(() => {
    kosSource.disconnect();
    FakeKosUplink.uninstall();
    localStorage.clear();
  });

  it("populates the main-screen CPU registry from a kos.processors frame", async () => {
    const fake = FakeKosUplink.install();
    const registry = new CpuRegistryService("main");

    render(
      <TelemetryProvider client={fake.client}>
        <KosCpuDiscovery />
        <CpuRegistryBridge registry={registry} />
      </TelemetryProvider>,
    );

    fake.setCpus([
      { number: 1, tagname: "datastream" },
      { number: 2, tagname: "lander" },
    ]);

    await waitFor(() => {
      const online = registry
        .list()
        .filter((e) => e.online)
        .map((e) => e.tagname)
        .sort();
      expect(online).toEqual(["datastream", "lander"]);
    });
  });

  it("drops a CPU from the registry when it leaves the kos.processors list", async () => {
    const fake = FakeKosUplink.install();
    const registry = new CpuRegistryService("main");

    render(
      <TelemetryProvider client={fake.client}>
        <KosCpuDiscovery />
        <CpuRegistryBridge registry={registry} />
      </TelemetryProvider>,
    );

    fake.setCpus([
      { number: 1, tagname: "datastream" },
      { number: 2, tagname: "lander" },
    ]);
    await waitFor(() =>
      expect(registry.list().filter((e) => e.online)).toHaveLength(2),
    );

    // Vessel switch — only one CPU remains loaded.
    fake.setCpus([{ number: 1, tagname: "datastream" }]);
    await waitFor(() => {
      const online = registry
        .list()
        .filter((e) => e.online)
        .map((e) => e.tagname);
      expect(online).toEqual(["datastream"]);
    });
  });
});
