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
//     as janky/failing legacy: the terminal is the valuable surface
//     (hub-wizard-kos plan, Phase 1, 2026-07-19). Their shared UI-authoring
//     infra (KosScriptFrame, KosCpuPicker, the kos-cpu-registry chrome
//     provider, useKosScriptPayload, useKosScriptStatus) went with them:
//     KosTerminal doesn't use that pattern, it reads kos.processors and
//     the terminal frame stream directly.
//
// To wire it into the app: `import "@ksp-gonogo/gonogo-kos-uplink";` during app bootstrap
// (alongside the other component-registration imports in app/src/main.tsx).
//
// Everything kOS-specific lives in this package: the CPU registry, the
// [KOSDATA] parser, and the KosDataSource transport itself (`dataSource/
// kos.ts`: `kos.run` dispatch, `kos.processors` CPU discovery, the
// kerboscript wrapper builder). The centralised `kos.compute.*` fanout
// (KosComputeManager) and the kerboscript registry that fed it
// (registerKosScript/getKosScripts, `shared/scriptRegistry.ts`) were
// deleted as dead code once the KosProcessors-style feed widgets that were
// their only consumers went with the widget streamline above, KosTerminal
// never used them. This is NOT a thin UI-only client over an app-side
// transport: see the kos migration plan (2026-07-18) for the full
// before/after.

// defineUplinkClient(KOS): every widget/augment this package registers
// stamps the returned handle as `owner`, so the widget picker's mod search
// tags derive "kos" automatically (Uplink Client Contract design §3.1/§3.3).
// (Also re-run by `./runtime`, below, idempotent, see that module's doc.)
import "./uplink";

export * from "./KosTerminal";

// Non-widget infra (defineUplinkClient/registerUplinkHandle side effects,
// KosCpuDiscovery, the shared CpuRegistryService/Context/[KOSDATA] parser/
// ScriptableDataSource) lives in `./runtime`, split out specifically so
// MainScreen/StationScreen can depend on it WITHOUT also evaluating
// `./KosTerminal` above (see `./runtime`'s own doc comment for why that
// matters to the Uplink loader). Re-exported here too so the package root
// keeps its full existing surface for every other consumer.
export * from "./runtime";
