import type { Screen } from "@ksp-gonogo/sitrep-sdk";
import type { ReactNode } from "react";
import { useState } from "react";
import { KosCpuDiscovery } from "../dataSource/KosCpuDiscovery";
import { KOS } from "../uplink";
import { CpuRegistryProvider } from "./CpuRegistryContext";
import { CpuRegistryService } from "./CpuRegistryService";

/**
 * kOS mounting its own CPU registry at the root of every screen.
 *
 * <p>This used to be the app's job. `MainScreen` constructed the service,
 * wrapped the tree in `CpuRegistryProvider` and mounted `KosCpuDiscovery`, and
 * `StationScreen` did it twice more, so `packages/app` imported this Uplink by
 * name and could not BUILD without it. That is the one thing a third-party
 * Uplink can never satisfy, and it is why the app treated kOS as first-party
 * whether or not anyone meant it to.</p>
 *
 * <p>The service is keyed by SCREEN because it persists to `localStorage`. A
 * station and the main screen on one machine hold different CPU sets, and a
 * single shared instance would have each overwrite the other's.</p>
 *
 * <p>The discovery component sits INSIDE the provider and reads the service
 * from context rather than taking it as a prop, so nothing above needs a
 * reference to it. It renders null; it exists to run its subscription.</p>
 */
function KosRootProvider({
  screen,
  children,
}: {
  screen: Screen;
  children: ReactNode;
}) {
  /*
   * Constructed once per mount, not per render: the service loads from storage
   * in its constructor and holds the listener set every consumer is attached
   * to, so a second instance would silently strand them.
   */
  const [service] = useState(() => new CpuRegistryService(screen));
  return (
    <CpuRegistryProvider service={service}>
      <KosCpuDiscovery cpuRegistry={service} />
      {children}
    </CpuRegistryProvider>
  );
}

KOS.registerRootProvider({
  id: "cpu-registry",
  Provider: KosRootProvider,
});
