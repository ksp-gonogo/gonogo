// kOS Uplink client for gonogo.
//
// Co-located with the Gonogo.Kos C# mod (mod/Gonogo.Kos): one directory holds
// the mod and the client TS it ships (Uplink architecture §1). Importing this
// package's entry point side-effects the widget + kOS-script registrations into
// @gonogo/core's global registries:
//
//   - the kOS widgets (KosProcessors, KosFiles, KosTerminal, KosScriptRunner,
//     KosWidget, KosWrapperTester) → registerComponent(...) so they are
//     placeable from the dashboard widget picker.
//   - the KosProcessors "processors" feed → registerKosScript(...) so the
//     centralised kOS compute loop fans its payload out to subscribers.
//
// To wire it into the app: `import "@gonogo/kos";` during app bootstrap
// (alongside the other component-registration imports in app/src/main.tsx).
//
// The kOS DATA SOURCE (KosDataSource + the useKosWidget / useKosScriptStatus
// hooks) stays in the app / @gonogo/data — these widgets consume kOS purely
// through those hooks and the @gonogo/core registry, so the client bundles no
// transport of its own (unlike @gonogo/kerbcast).

export * from "./KosFiles";
export * from "./KosProcessors";
export * from "./KosScriptRunner";
export * from "./KosTerminal";
export * from "./KosWidget";
export * from "./KosWrapperTester";

// Shared kOS widget infra (KosScriptFrame, KosCpuPicker, useKosScriptPayload),
// re-exported for consumers that build their own kOS-driven widgets.
export * from "./shared";
