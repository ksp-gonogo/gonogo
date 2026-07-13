import { getDataSource } from "@ksp-gonogo/core";
import { useTelemetryClientOptional } from "@ksp-gonogo/sitrep-client";
import { useEffect } from "react";
import { KosDataSource } from "./kos";

/**
 * Stands up kOS CPU discovery for the lifetime of the mounted sitrep stream.
 *
 * Discovery rides the mod's native `kos.processors` push channel, which the
 * `KosDataSource`'s Uplink executor already subscribes to for tagname →
 * coreId resolution. That subscription only exists once a `TelemetryClient`
 * is adopted, so this component — mounted inside `<SitrepTelemetryProvider>`,
 * a sibling of `SitrepPeerRelay` — hands the live client to the source the
 * moment it's available (and on every client change: a reconnect / provider
 * remount mints a fresh client). Adoption is idempotent for the same client.
 *
 * The screen owns the registry wiring (`kos.onProcessorsChanged` →
 * `CpuRegistryService.reportOnline`, see `MainScreen.tsx`); this component's
 * only job is to make that feed STANDING — populating discovery whenever a
 * stream is mounted, not only while a `kos.run` dispatch is pending.
 *
 * Renders nothing. Main-screen only — stations don't dispatch to kOS.
 */
export function KosCpuDiscovery() {
  const client = useTelemetryClientOptional();

  useEffect(() => {
    if (!client) return;
    const kos = getDataSource("kos");
    if (!(kos instanceof KosDataSource)) return;
    kos.attachTelemetryClient(client);
  }, [client]);

  return null;
}
