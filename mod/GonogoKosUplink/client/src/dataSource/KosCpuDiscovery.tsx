import { useTelemetryClientOptional } from "@ksp-gonogo/sitrep-sdk";
import { useEffect } from "react";
import type { CpuRegistryService } from "../shared/CpuRegistryService";
import { kosSource } from "./kos";

/**
 * Stands up kOS CPU discovery for the lifetime of the mounted sitrep stream,
 * and feeds the result into the screen's CPU registry. Merges what used to
 * be two separate pieces (`KosCpuDiscovery` + `useKosMainWiring`) into one
 * component now that both live in the kos Uplink package alongside the
 * concrete `kosSource` instance they both reach into directly.
 *
 * Discovery rides the mod's native `kos.processors` push channel, which the
 * `KosDataSource`'s Uplink executor already subscribes to for tagname →
 * coreId resolution. That subscription only exists once a `TelemetryClient`
 * is adopted, so this component — mounted inside `<SitrepTelemetryProvider>`,
 * a sibling of `SitrepPeerRelay` — hands the live client to the source the
 * moment it's available (and on every client change: a reconnect / provider
 * remount mints a fresh client). Adoption is idempotent for the same client.
 *
 * `cpuRegistry` is populated from the same `kos.processors` feed via
 * `kosSource.onProcessorsChanged` → `cpuRegistry.reportOnline`, mirroring
 * `MainScreen`'s previous `useKosMainWiring` wiring exactly.
 *
 * Renders nothing. Main-screen only — stations don't dispatch to kOS.
 */
export function KosCpuDiscovery({
  cpuRegistry,
}: {
  cpuRegistry: CpuRegistryService;
}) {
  const client = useTelemetryClientOptional();

  useEffect(() => {
    if (!client) return;
    // kosSource is always the registered "kos" Uplink handle in-process
    // (this component only mounts on the main screen), so the instanceof
    // check that used to guard a generic getDataSource("kos") lookup isn't
    // needed here — it imports the concrete instance directly.
    kosSource.attachTelemetryClient(client);
  }, [client]);

  useEffect(() => {
    return kosSource.onProcessorsChanged((procs) => {
      cpuRegistry.reportOnline(
        procs.map((p) => p.tag).filter((tag): tag is string => Boolean(tag)),
      );
    });
  }, [cpuRegistry]);

  return null;
}
