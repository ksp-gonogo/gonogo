// kOS Uplink client for gonogo.
//
// Co-located with the GonogoKosUplink C# mod (mod/GonogoKosUplink): one directory holds
// the mod and the client TS it ships (Uplink architecture §1). Importing this
// package's entry point side-effects the widget registrations into
// @ksp-gonogo/core's global registry:
//
//   - the kOS widgets (KosProcessors, KosFiles, KosTerminal, KosScriptRunner,
//     KosWidget, KosWrapperTester) → registerComponent(...) so they are
//     placeable from the dashboard widget picker.
//   - the CPU registry → registerChromeProvider(...) so generic dashboard
//     chrome (ComponentOverlay, WidgetGearMenu) can re-supply it around
//     portal-rendered config UI without importing anything kOS-named.
//
// To wire it into the app: `import "@ksp-gonogo/kos";` during app bootstrap
// (alongside the other component-registration imports in app/src/main.tsx).
//
// Everything kOS-specific now lives in this package: the centralised
// kerboscript registry (registerKosScript/getKosScripts, `shared/
// scriptRegistry.ts` — a kOS-owned mechanism per the migration plan's
// explicit "no generalising" call, not a core-generic extension point), the
// CPU registry, the [KOSDATA] parser, and (moving here next) the
// KosDataSource transport itself. It is NOT a thin UI-only client over an
// app-side transport — see the kos migration plan (2026-07-18) for the
// full before/after.

export * from "./KosFiles";
export * from "./KosProcessors";
export * from "./KosScriptRunner";
export * from "./KosTerminal";
export * from "./KosWidget";
export * from "./KosWrapperTester";

// Registers the CPU registry with @ksp-gonogo/core's generic chrome-provider
// registry (see chromeProviders.ts's design note) so ComponentOverlay/
// WidgetGearMenu can re-supply it around portal-rendered config UI without
// importing anything kOS-named.
import "./shared/kosChromeProvider";

// Shared kOS widget infra (KosScriptFrame, KosCpuPicker, useKosScriptPayload),
// re-exported for consumers that build their own kOS-driven widgets.
export * from "./shared";
