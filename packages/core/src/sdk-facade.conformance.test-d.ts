// ---------------------------------------------------------------------------
// Drift guard: the @ksp-gonogo/sitrep-sdk author-facing type MIRROR vs core's
// (and, since Phase 0.4, sitrep-client's) real types.
//
// sitrep-sdk is the dependency-graph leaf, so it cannot import core OR
// sitrep-client (either would form a turbo `^build` cycle — core and
// sitrep-client both depend on the sdk already). Its author-facing types are
// therefore mirrored by hand in `mod/sitrep-sdk/src/api/types.ts`. THIS file —
// living in core, which already devDepends on the sdk AND carries a real
// dependency on sitrep-client — is the only place all three sides are
// visible, so it is where every mirror is kept honest: if a real type drifts
// out of structural compatibility with the published facade, this fails
// core's `tsc` typecheck.
//
// Retire this file when the loader work inverts the type source into the leaf
// (the facade then re-exports the real types and there is nothing to mirror).
// ---------------------------------------------------------------------------

import type {
  CommandStatus as ClientCommandStatus,
  DelayClockLike as ClientDelayClockLike,
  LateTelemetrySubscribe as ClientLateTelemetrySubscribe,
  StreamStatusValue as ClientStreamStatusValue,
  TelemetryClient as ClientTelemetryClient,
  UseCommandResult as ClientUseCommandResult,
} from "@ksp-gonogo/sitrep-client";
import type {
  ActionDefinition as SdkActionDefinition,
  AugmentDefinition as SdkAugmentDefinition,
  BodyDefinition as SdkBodyDefinition,
  CommandStatus as SdkCommandStatus,
  ComponentDefinition as SdkComponentDefinition,
  ComponentProps as SdkComponentProps,
  ConfigComponentProps as SdkConfigComponentProps,
  ConfigField as SdkConfigField,
  DataKey as SdkDataKey,
  DataSource as SdkDataSource,
  DataSourceStatus as SdkDataSourceStatus,
  DelayClockLike as SdkDelayClockLike,
  LateTelemetrySubscribe as SdkLateTelemetrySubscribe,
  MapPoi as SdkMapPoi,
  PerfBudgetOptions as SdkPerfBudgetOptions,
  Screen as SdkScreen,
  SettingsTabDefinition as SdkSettingsTabDefinition,
  StreamStatusValue as SdkStreamStatusValue,
  TelemetryClient as SdkTelemetryClient,
  ThemeDefinition as SdkThemeDefinition,
  UseCommandResult as SdkUseCommandResult,
} from "@ksp-gonogo/sitrep-sdk";
import type { AugmentDefinition as CoreAugmentDefinition } from "./augments";
import type { BodyDefinition as CoreBodyDefinition } from "./bodies";
import type { Screen as CoreScreen } from "./contexts/ScreenContext";
import type { MapPoi as CoreMapPoi } from "./mapPoi";
import type { PerfBudgetOptions as CorePerfBudgetOptions } from "./perf/PerfBudget";
import type { SettingsTabDefinition as CoreSettingsTabDefinition } from "./settingsTabs";
import type * as Core from "./types";

type Assignable<A, B> = A extends B ? true : false;
type Expect<T extends true> = T;

// Registration-boundary direction (facade value must satisfy the real API): the
// facade type is assignable to core's, so an author's def is accepted by the
// app's real registerX at the injection seam.
type _Component = Expect<
  Assignable<SdkComponentDefinition, Core.ComponentDefinition>
>;
type _ComponentBack = Expect<
  Assignable<Core.ComponentDefinition, SdkComponentDefinition>
>;
type _ComponentProps = Expect<
  Assignable<SdkComponentProps, Core.ComponentProps>
>;
type _ComponentPropsBack = Expect<
  Assignable<Core.ComponentProps, SdkComponentProps>
>;
type _ConfigProps = Expect<
  Assignable<SdkConfigComponentProps, Core.ConfigComponentProps>
>;
type _Action = Expect<Assignable<SdkActionDefinition, Core.ActionDefinition>>;
type _ActionBack = Expect<
  Assignable<Core.ActionDefinition, SdkActionDefinition>
>;
type _Augment = Expect<Assignable<SdkAugmentDefinition, CoreAugmentDefinition>>;
type _AugmentBack = Expect<
  Assignable<CoreAugmentDefinition, SdkAugmentDefinition>
>;
type _Perf = Expect<Assignable<SdkPerfBudgetOptions, CorePerfBudgetOptions>>;
type _PerfBack = Expect<
  Assignable<CorePerfBudgetOptions, SdkPerfBudgetOptions>
>;
// ThemeDefinition mirrors `theme` loosely (the real token type ships from ui-kit,
// not this leaf), so only the read direction — core's concrete theme fits the
// facade view — is asserted.
type _Theme = Expect<Assignable<Core.ThemeDefinition, SdkThemeDefinition>>;

// DataSource type mirror (facade-sealing, 2026-07-19 final removal of the
// registerDataSource/getDataSource author SPI — kos and scansat are both off
// it for good now, see mod/sitrep-sdk/src/api/types.ts's own history
// comment). The mirror itself stays: an Uplink can still type its own
// connection-status field (e.g. KerbcastDataSource's `status:
// DataSourceStatus`) against it without registering through the facade, so
// both directions are still checked here.
type _DataSource = Expect<Assignable<SdkDataSource, Core.DataSource>>;
type _DataSourceBack = Expect<Assignable<Core.DataSource, SdkDataSource>>;
type _DataSourceStatus = Expect<
  Assignable<SdkDataSourceStatus, Core.DataSourceStatus>
>;
type _DataSourceStatusBack = Expect<
  Assignable<Core.DataSourceStatus, SdkDataSourceStatus>
>;
type _ConfigField = Expect<Assignable<SdkConfigField, Core.ConfigField>>;
type _ConfigFieldBack = Expect<Assignable<Core.ConfigField, SdkConfigField>>;
type _DataKey = Expect<Assignable<SdkDataKey, Core.DataKey>>;
type _DataKeyBack = Expect<Assignable<Core.DataKey, SdkDataKey>>;

// Map/fog SPI (facade-sealing, 2026-07-19): BodyDefinition and MapPoi are
// owned by core (bodies.ts / mapPoi.ts), not this file's ./types — checked
// both directions same as every other core-owned mirror above.
type _Body = Expect<Assignable<SdkBodyDefinition, CoreBodyDefinition>>;
type _BodyBack = Expect<Assignable<CoreBodyDefinition, SdkBodyDefinition>>;
type _MapPoi = Expect<Assignable<SdkMapPoi, CoreMapPoi>>;
type _MapPoiBack = Expect<Assignable<CoreMapPoi, SdkMapPoi>>;

// Screen identity (facade-sealing, 2026-07-19): owned by
// contexts/ScreenContext.tsx.
type _Screen = Expect<Assignable<SdkScreen, CoreScreen>>;
type _ScreenBack = Expect<Assignable<CoreScreen, SdkScreen>>;

// Settings tabs (facade-sealing, 2026-07-19): owned by settingsTabs.ts.
// Read direction only — `component: ComponentType` on both sides is
// already covered structurally by the other ComponentType-bearing checks
// above; asserting the SDK-authored direction here would require a
// concrete component value, which isn't the point of this drift guard.
type _SettingsTab = Expect<
  Assignable<CoreSettingsTabDefinition, SdkSettingsTabDefinition>
>;

// Stream SPI (Phase 0.4): StreamStatusValue is owned by sitrep-client, not
// core, but core carries a real dependency on sitrep-client so it is visible
// here too — same drift-guard shape as the core-owned types above.
type _StreamStatus = Expect<
  Assignable<SdkStreamStatusValue, ClientStreamStatusValue>
>;
type _StreamStatusBack = Expect<
  Assignable<ClientStreamStatusValue, SdkStreamStatusValue>
>;

// Telemetry client (facade-sealing, 2026-07-19): TelemetryClient is owned
// by sitrep-client too, same visibility as StreamStatusValue above. Only
// the read direction is asserted — the sdk's mirror is a deliberately
// NARROWED subset of the real class's public surface (subscribe/getValue/
// dispatch/dispose only, see ./types.ts's TelemetryClient doc), so the
// real class satisfies the mirror but not vice-versa.
type _TelemetryClient = Expect<
  Assignable<ClientTelemetryClient, SdkTelemetryClient>
>;

// Media delay clock SPI (facade-sealing, kerbcast, 2026-07-19):
// `DelayClockLike` is owned by sitrep-client too (media/delayed-playout-
// buffer.ts), same visibility as StreamStatusValue/TelemetryClient above.
// Unlike TelemetryClient's deliberately-narrowed one-way mirror, the two
// methods here ARE the real interface's whole surface, so both directions
// are asserted — the mirror is structurally identical, not a subset.
type _DelayClockLike = Expect<
  Assignable<SdkDelayClockLike, ClientDelayClockLike>
>;
type _DelayClockLikeBack = Expect<
  Assignable<ClientDelayClockLike, SdkDelayClockLike>
>;

// Command SPI (facade-sealing, kos, 2026-07-19): CommandStatus and
// UseCommandResult are owned by sitrep-client too (lifecycle.ts /
// use-command.ts), same visibility as StreamStatusValue/TelemetryClient
// above. Both are structurally identical mirrors (not narrowed subsets), so
// both directions are asserted for each — this is the check that should have
// caught the original drift (the mirror's `send`/`status` shape had fallen
// out of sync with the real hook).
type _CommandStatus = Expect<Assignable<SdkCommandStatus, ClientCommandStatus>>;
type _CommandStatusBack = Expect<
  Assignable<ClientCommandStatus, SdkCommandStatus>
>;
type _UseCommandResult = Expect<
  Assignable<SdkUseCommandResult, ClientUseCommandResult>
>;
type _UseCommandResultBack = Expect<
  Assignable<ClientUseCommandResult, SdkUseCommandResult>
>;

// Late telemetry subscribe SPI (facade-sealing, scansat fog-sync, 2026-07-19):
// LateTelemetrySubscribe is owned by sitrep-client too
// (use-late-telemetry-subscribe.ts), same visibility as StreamStatusValue/
// TelemetryClient above. It builds on TopicId/TopicPayload, which are
// sdk-native, so the mirror is structurally identical, not a narrowed
// subset: both directions are asserted. The client's own `Unsubscribe`
// alias has no sdk-side counterpart to compare (the sdk writes the return
// position out as `() => void` directly, to avoid colliding with the
// generated wire contract's own `Unsubscribe` message type, see
// mod/sitrep-sdk/src/api/types.ts) but that return position is still
// covered structurally by the two checks below.
type _LateTelemetrySubscribe = Expect<
  Assignable<SdkLateTelemetrySubscribe, ClientLateTelemetrySubscribe>
>;
type _LateTelemetrySubscribeBack = Expect<
  Assignable<ClientLateTelemetrySubscribe, SdkLateTelemetrySubscribe>
>;

// Keep the aliases "used" under noUnusedLocals.
export type _SdkFacadeConformance = [
  _Component,
  _ComponentBack,
  _ComponentProps,
  _ComponentPropsBack,
  _ConfigProps,
  _Action,
  _ActionBack,
  _Augment,
  _AugmentBack,
  _Perf,
  _PerfBack,
  _Theme,
  _DataSource,
  _DataSourceBack,
  _DataSourceStatus,
  _DataSourceStatusBack,
  _ConfigField,
  _ConfigFieldBack,
  _DataKey,
  _DataKeyBack,
  _Body,
  _BodyBack,
  _MapPoi,
  _MapPoiBack,
  _Screen,
  _ScreenBack,
  _SettingsTab,
  _StreamStatus,
  _StreamStatusBack,
  _TelemetryClient,
  _DelayClockLike,
  _DelayClockLikeBack,
  _CommandStatus,
  _CommandStatusBack,
  _UseCommandResult,
  _UseCommandResultBack,
  _LateTelemetrySubscribe,
  _LateTelemetrySubscribeBack,
];
