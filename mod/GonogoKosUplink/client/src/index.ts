// kOS Uplink client for gonogo.
//
// Co-located with the GonogoKosUplink C# mod (mod/GonogoKosUplink): one directory holds
// the mod and the client TS it ships (Uplink architecture §1). Importing this
// package's entry point side-effects the widget registration into
// @ksp-gonogo/core's global registry:
//
//   - KosTerminal → registerComponent(...) so it's placeable from the
//     dashboard widget picker. The other kOS widgets (KosProcessors,
//     KosFiles, KosScriptRunner, KosWidget, KosWrapperTester) were removed
//     as janky/failing legacy — the terminal is the valuable surface
//     (hub-wizard-kos plan, Phase 1, 2026-07-19). Their shared UI-authoring
//     infra (KosScriptFrame, KosCpuPicker, the kos-cpu-registry chrome
//     provider, useKosScriptPayload, useKosScriptStatus) went with them —
//     KosTerminal doesn't use that pattern, it reads kos.processors and
//     the terminal frame stream directly.
//
// To wire it into the app: `import "@ksp-gonogo/kos";` during app bootstrap
// (alongside the other component-registration imports in app/src/main.tsx).
//
// Everything kOS-specific now lives in this package: the centralised
// kerboscript registry (registerKosScript/getKosScripts, `shared/
// scriptRegistry.ts` — a kOS-owned mechanism per the migration plan's
// explicit "no generalising" call, not a core-generic extension point), the
// CPU registry, the [KOSDATA] parser, and the KosDataSource transport
// itself (`dataSource/kos.ts` — `kos.run` dispatch, `kos.processors` CPU
// discovery, the centralised `kos.compute.*` fanout, the kerboscript
// wrapper builder). This is NOT a thin UI-only client over an app-side
// transport — see the kos migration plan (2026-07-18) for the full
// before/after.

export * from "./KosTerminal";

// registerDataSource(kosSource) / registerUplinkHandle("kos", kosSource) —
// fires whenever this package loads, whether via the runtime Uplink loader
// or the bundled-fallback static import in main.tsx.
import "./dataSource/kos";

export { KosCpuDiscovery } from "./dataSource/KosCpuDiscovery";
export { useKosMainWiring } from "./dataSource/useKosMainWiring";

// Shared kOS infra (CpuRegistryService/Context, the [KOSDATA] parser,
// ScriptableDataSource, the kerboscript registry, useKosWidget), re-exported
// for MainScreen/StationScreen and any future kOS-driven widget.
export * from "./shared";
