// GonogoRealAntennasUplink client for gonogo.
//
// Co-located with the GonogoRealAntennasUplink C# mod
// (mod/GonogoRealAntennasUplink): one directory holds the mod and the client TS
// it ships (Uplink architecture §1).
//
// This one registers NO widget, and that is not an omission. RealAntennas is an
// elected PROVIDER: its main job is to make the shared comms.* channels richer,
// which every existing comms widget already reads without knowing RA exists. The
// three channels only RA can source (`comms.linkQuality` / `comms.dataRate` /
// `comms.linkMargin`) have no reader in the app today, and when one lands it
// belongs here rather than in the base component library.
//
// So the package's whole surface is its Topics: the three payload types and
// their registrations, relocated out of the core contract along with the C#
// types that declare them.
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
} from "./__generated__/contract";
export * from "./topics";
