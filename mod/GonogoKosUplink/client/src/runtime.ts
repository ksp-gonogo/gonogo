// Non-widget kOS runtime infra — split out of `index.ts` so importing it does
// NOT evaluate `./KosTerminal`.
//
// MainScreen/StationScreen need `CpuRegistryProvider`/`CpuRegistryService`/
// `KosCpuDiscovery` regardless of whether the KosTerminal WIDGET itself is
// statically bundled or loaded at runtime via the Uplink loader
// (`app/src/uplinks/loader.ts`). Before this split they imported those names
// from the package root (`@ksp-gonogo/kos`), which forced evaluation of the
// WHOLE `index.ts` module — ES module evaluation always runs a module's full
// top-level code once, regardless of which named export the importer actually
// uses — including `export * from "./KosTerminal"`, which self-registers the
// "kos-terminal" widget via `registerComponent`. `@ksp-gonogo/core` makes that
// call THROW on a duplicate id (by design — component ids must be unique), so
// under the runtime-loader flag the loader's OWN dynamically-imported
// `kos.client.js` bundle always collided with the copy MainScreen had already
// registered at module-load time, and always quarantined
// ("Component id \"kos-terminal\" is already registered…" — caught by
// `uplink-loader.spec.ts`'s Settings "Loaded clients" panel assertion).
//
// Every registration this file DOES still trigger (`defineUplinkClient`,
// `registerUplinkHandle`) is Map-based and idempotent — re-running it from
// both this file AND the loaded bundle is harmless, unlike `registerComponent`.
//
// `index.ts` re-exports this file, so nothing downstream of the package root
// loses access to these names — only MainScreen/StationScreen need to import
// from `@ksp-gonogo/kos/runtime` specifically instead of the package root.

import "./uplink"; // defineUplinkClient(KOS) — idempotent re-registration
import "./dataSource/kos"; // registerUplinkHandle("kos", kosSource) — idempotent

export { KosCpuDiscovery } from "./dataSource/KosCpuDiscovery";
export * from "./shared";
