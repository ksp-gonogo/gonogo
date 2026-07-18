// Type-level half of the author-surface shape gate (see api-shape.gate.test.ts
// for the runtime half). Enforced by `tsc` via tsconfig.test-d.json, matching
// the topics.test-d.ts convention. Removing or renaming any exported author type
// breaks this compile — the type analogue of the runtime export-name lock.
//
// PROPOSAL surface (design D-D). This is the current recorded type list; it is
// not frozen until operator sign-off.

import type {
  ActionDefinition,
  ActionHandlers,
  ActionInputKind,
  ActionInputPayload,
  AugmentDefinition,
  AugmentSettingField,
  ComponentBehavior,
  ComponentDefinition,
  ComponentProps,
  ComponentRequirement,
  ConfigComponentProps,
  ConfigField,
  DataKey,
  DataRequirement,
  DataSource,
  DataSourceStatus,
  GonogoHost,
  KosScriptDefinition,
  KosScriptField,
  Logger,
  PerfBudgetHandle,
  PerfBudgetOptions,
  SlotId,
  SlotProps,
  SlotRegistry,
  StreamStatusValue,
  TaggedLogger,
  ThemeDefinition,
  UseCommandResult,
} from "./index";

// Reference every exported type so a removal/rename is a compile error. The
// declarations are `declare`d (never constructed) — this is a name+assignability
// probe, not a value test.
declare const _componentDef: ComponentDefinition<{ label: string }>;
declare const _componentProps: ComponentProps<{ label: string }>;
declare const _configProps: ConfigComponentProps;
declare const _behavior: ComponentBehavior;
declare const _requirement: ComponentRequirement;
declare const _dataReq: DataRequirement;
declare const _actionDef: ActionDefinition;
declare const _actionKind: ActionInputKind;
declare const _actionPayload: ActionInputPayload;
declare const _actionHandlers: ActionHandlers<
  readonly [{ id: "fire"; label: "Fire"; accepts: readonly ["button"] }]
>;
declare const _augmentDef: AugmentDefinition<"slot">;
declare const _augmentSetting: AugmentSettingField;
declare const _slotId: SlotId;
declare const _slotProps: SlotProps<"slot">;
declare const _slotRegistry: SlotRegistry;
declare const _themeDef: ThemeDefinition;
declare const _kosDef: KosScriptDefinition;
declare const _kosField: KosScriptField;
declare const _perfOpts: PerfBudgetOptions;
declare const _perfHandle: PerfBudgetHandle;
declare const _useCommandResult: UseCommandResult;
declare const _host: GonogoHost;
declare const _logger: Logger;
declare const _taggedLogger: TaggedLogger;
declare const _dataSource: DataSource;
declare const _dataSourceStatus: DataSourceStatus;
declare const _configField: ConfigField;
declare const _dataKey: DataKey;
declare const _streamStatusValue: StreamStatusValue;

// The author-set core of a ComponentDefinition must remain assignable — a probe
// that the required fields don't silently become optional or retyped.
const _probe: ComponentDefinition = {
  id: "x",
  name: "X",
  description: "",
  tags: [],
  component: () => null,
};

// Keep the declarations "used" so noUnusedLocals doesn't flip the gate.
export type _ApiShapeProbe = [
  typeof _componentDef,
  typeof _componentProps,
  typeof _configProps,
  typeof _behavior,
  typeof _requirement,
  typeof _dataReq,
  typeof _actionDef,
  typeof _actionKind,
  typeof _actionPayload,
  typeof _actionHandlers,
  typeof _augmentDef,
  typeof _augmentSetting,
  typeof _slotId,
  typeof _slotProps,
  typeof _slotRegistry,
  typeof _themeDef,
  typeof _kosDef,
  typeof _kosField,
  typeof _perfOpts,
  typeof _perfHandle,
  typeof _useCommandResult,
  typeof _host,
  typeof _logger,
  typeof _taggedLogger,
  typeof _dataSource,
  typeof _dataSourceStatus,
  typeof _configField,
  typeof _dataKey,
  typeof _streamStatusValue,
  typeof _probe,
];
