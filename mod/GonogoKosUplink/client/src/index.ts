// kOS Uplink client for gonogo.
//
// Co-located with the GonogoKosUplink C# mod (mod/GonogoKosUplink): one directory holds
// the mod and the client TS it ships. Importing this
// package's entry point side-effects the widget registration into
// @ksp-gonogo/core's global registry:
//
//   - KosTerminal → registerComponent(...) so it's placeable from the
//     dashboard widget picker. It reads kos.processors and the terminal
//     frame stream directly.
//
// To wire it into the app: `import "@ksp-gonogo/gonogo-kos-uplink";` during app bootstrap
// (alongside the other component-registration imports in app/src/main.tsx).
//
// Everything kOS-specific lives in this package: the CPU registry, the
// [KOSDATA] parser, and the KosDataSource transport itself (`dataSource/
// kos.ts`: `kos.run` dispatch, `kos.processors` CPU discovery, the
// kerboscript wrapper builder). This is NOT a thin UI-only client over an
// app-side transport.

// defineUplinkClient(KOS): every widget/augment this package registers
// stamps the returned handle as `owner`, so the widget picker's mod search
// tags derive "kos" automatically.
// (Also re-run by `./runtime`, below, idempotent, see that module's doc.)
import "./uplink";
/*
 * Side-effect import: mounts kOS's CPU registry at the root of every screen.
 * Registered here rather than hand-wired into the app's screens, which is what
 * made `packages/app` import this Uplink by name and unable to build without
 * it. See `./shared/rootProvider` for why the service is keyed by screen.
 */
import "./shared/rootProvider";

// This Uplink's own wire payload types, now that it declares them rather than
// core (relocated out of Sitrep.Contract, see ./topics.ts and
// ../../GonogoKosUplink.Contract). A consumer that reads a kos.* channel names
// its shape from HERE, the same way it used to name it from
// @ksp-gonogo/sitrep-sdk. All nine are exported, including the command args:
// a caller building a kos.run or kos.keystroke payload needs the arg shape as
// much as a reader needs the frame shape.
export type {
  KosComputeStatus,
  KosKeystrokeArgs,
  KosProcessorInfo,
  KosRunArgs,
  KosRunResult,
  KosTerminalCloseArgs,
  KosTerminalFrame,
  KosTerminalOpenArgs,
  KosTerminalResizeArgs,
} from "./__generated__/contract";
// This Uplink's own commands: the `CommandArgsMap`/`CommandReplyMap`
// augmentation and the runtime registration. RE-EXPORTED rather than imported
// for side effect, for the same reason ./topics is: a bare import is elided from
// the emitted `dist/index.d.ts` and the augmentation would not cross the package
// boundary.
export { UPLINK_COMMAND_IDS } from "./commands";
export * from "./KosScriptTrigger";
export * from "./KosTerminal";
// Non-widget infra (defineUplinkClient/registerUplinkHandle side effects,
// KosCpuDiscovery, the shared CpuRegistryService/Context/[KOSDATA] parser/
// ScriptableDataSource) lives in `./runtime`, split out specifically so
// MainScreen/StationScreen can depend on it WITHOUT also evaluating
// `./KosTerminal` above (see `./runtime`'s own doc comment for why that
// matters to the Uplink loader). Re-exported here too so the package root
// keeps its full existing surface for every other consumer.
export * from "./runtime";
// The kos.processors Topic registration. RE-EXPORTED rather than imported for
// side effect alone, and that is load-bearing in two ways: it keeps bundlers
// from tree-shaking the registration calls, AND it puts a real
// `export ... from "./topics"` into the built `dist/index.d.ts`, which is what
// carries topics.ts's `declare module "@ksp-gonogo/sitrep-sdk"` TopicPayloadMap
// augmentation across the package boundary. A bare `import "./topics"` is elided
// from the emitted declaration, so a consumer would silently see
// `useTelemetry("kos.processors")` resolve to `unknown` with nothing going red
// here (the same failure mode ui-kit's styledComponentsTheme.ts documents for
// its own augmentation).
export { KOS_PROCESSORS_TOPIC } from "./topics";
