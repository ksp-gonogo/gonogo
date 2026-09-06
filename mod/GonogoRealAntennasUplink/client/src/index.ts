// GonogoRealAntennasUplink client for gonogo.
//
// Co-located with the GonogoRealAntennasUplink C# mod
// (mod/GonogoRealAntennasUplink): one directory holds the mod and the client TS
// it ships.
//
// This one registers NO standalone widget, and that is deliberate. RealAntennas
// is an elected PROVIDER: its main job is to make the shared comms.* channels
// richer, which every existing comms widget already reads without knowing RA
// exists. What it DOES register is two augments into the base CommSignal widget's
// slots (`comm-signal.badges` / `comm-signal.sections`), so the RA-only detail
// appears inside CommSignal only when RA is installed and CommSignal stays
// RA-agnostic. Those augments are the reader the three RA-only channels
// (`comms.linkQuality` / `comms.dataRate` / `comms.linkMargin`) and the per-hop
// `extensions.realantennas` bag were waiting for: the data reached the SDK end to
// end and then stopped, and now it renders.
//
// So the package's surface is its Topics (the three payload types + the hop-bag
// type and their registrations, relocated out of the core contract) plus the RA
// CommSignal augments and the typed hop-bag reader.
//
// `export *` rather than a bare `import "./topics"`: a side-effect-only import
// is ELIDED from the emitted `dist/index.d.ts`, so the `declare module`
// TopicPayloadMap augmentation inside it would never cross the package boundary
// and every consumer would silently resolve these Topics to `unknown`. The
// re-export is what carries it. Same failure mode
// `packages/ui-kit/src/styledComponentsTheme.ts` documents for its own
// augmentation.
//
// There is deliberately no `./runtime` subpath entry here. A sibling Uplink
// needed one to let the app take its data layer WITHOUT evaluating a heavy
// widget, and that split cost it a second side-effect import site to keep the
// Topic registrations alive for consumers loading only that half. With no
// widget, this package has one entry point and one place the registration can be
// missed from.

export type {
  CommsDataRate,
  CommsLinkMargin,
  CommsLinkQuality,
  RealAntennasAntennaArgs,
  RealAntennasAntennaState,
  RealAntennasHopExt,
  RealAntennasTargetArgs,
} from "./__generated__/contract";
// The per-hop forward-rate contribution: fills CommSignal's `comm-signal.hop-rates`
// slot off `realantennas.hopRates`, so the base route schedule can render each
// leg's bitrate and flag the bottleneck without naming RealAntennas.
export { computeRealAntennasHopRates } from "./CommSignal/hopRates";
// The RA CommSignal augments (badges + sections): the readers for the three
// RA-only channels and the per-hop bag that used to reach the SDK and stop.
// `export` (not a bare side-effect import) so the `registerAugment` calls run at
// module load AND the surface is importable by tests.
export {
  CommSignalRaBadges,
  CommSignalRaSection,
} from "./CommSignalRaAugment";
// The two antenna-targeting commands. `export *` for the same reason topics.ts
// is re-exported: a side-effect-only import is elided from the emitted
// dist/index.d.ts, so the CommandArgsMap augmentation inside it would never
// cross the package boundary.
export * from "./commands";
// The typed reader + hop-bag hydration registration for extensions.realantennas.
export { readRealAntennasHopExt } from "./hopExt";
export * from "./topics";

// Side-effect registrations at module load: importing this package wires the RA
// augments into CommSignal's slots. Kept un-aliased so the bundler does not
// tree-shake the registrations away.
import "./CommSignalRaAugment";
import "./CommSignal/hopRates";
