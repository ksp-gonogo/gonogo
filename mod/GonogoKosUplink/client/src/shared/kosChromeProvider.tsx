import { registerChromeProvider } from "@ksp-gonogo/core";
import type { ReactNode } from "react";
import {
  CpuRegistryProvider,
  useCpuRegistryService,
} from "./CpuRegistryContext";
import type { CpuRegistryService } from "./CpuRegistryService";

/**
 * Adapter matching ChromeProviderDefinition's generic `{ value, children }`
 * Provider shape — CpuRegistryProvider's own prop is named `service` (used
 * that way at every other call site: MainScreen, StationScreen, tests), so
 * this thin wrapper is the seam rather than renaming the widely-used prop.
 */
function CpuRegistryChromeProvider({
  value,
  children,
}: {
  value: CpuRegistryService;
  children: ReactNode;
}) {
  return <CpuRegistryProvider service={value}>{children}</CpuRegistryProvider>;
}

/**
 * Lets ComponentOverlay/WidgetGearMenu re-provide the CPU registry around
 * portal-rendered widget config UI without importing anything kOS-named.
 * See chromeProviders.ts's design note (kos migration plan, 2026-07-18).
 */
registerChromeProvider({
  id: "kos-cpu-registry",
  useValue: useCpuRegistryService,
  Provider: CpuRegistryChromeProvider,
});
