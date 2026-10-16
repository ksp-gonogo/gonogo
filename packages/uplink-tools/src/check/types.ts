import type { TypeScript } from "./program";

export type Severity = "error" | "warning";

/** One thing a rule found, in the shape `--json` prints. */
export interface Finding {
  rule: string;
  severity: Severity;
  file: string;
  line: number;
  message: string;
  fixable: boolean;
  /** The one command or edit that heals it. */
  fix: string;
}

export interface CheckContext {
  /** The client package directory, absolute. */
  clientDir: string;
  scan: ClientScan;
  /** The TypeScript the client was read with; absent for an Uplink with no client. */
  ts?: TypeScript;
  /** The dynamic prefixes the installed sdk registers by itself. */
  dynamicPrefixes: readonly string[];
  /** Why `dynamicPrefixes` is empty when the installed sdk's could not be read. */
  dynamicPrefixesProblem?: string;
}

/** A finding a rule can heal, with the heal attached. */
export interface FixableFinding extends Finding {
  apply?: () => void;
}

export interface Rule {
  /** Stable, `<group>/<name>`. */
  id: string;
  group: string;
  /**
   * Set on a rule that reads nothing of the client, so it can judge an Uplink
   * that has none. `check` runs only these when the Uplink has no client.
   */
  clientless?: boolean;
  check(ctx: CheckContext): FixableFinding[];
}

export interface ReadRecord {
  /** A Topic id or a command id when the read is exact. */
  id?: string;
  /** A family pattern such as `trackingStation.vessel.<vessel>.link`. */
  family?: string;
  call: string;
  file: string;
  line: number;
  /** Set when a `// gonogo:reads` directive supplied it. */
  directive?: boolean;
  /** Set when the read arrives through a processor's inputs rather than the call itself. */
  via?: "processor";
}

export interface UnresolvedRecord {
  call: string;
  file: string;
  line: number;
  reason: string;
}

export interface DirectiveRecord {
  file: string;
  line: number;
  values: string[];
  /** The directive sat on a call the scanner could not resolve without it. */
  needed: boolean;
  /** No call stands on the line the directive points at. */
  attached: boolean;
}

export interface Registration {
  id: string;
  file: string;
  line: number;
  /** Required Topics, as written. Undefined when the field is absent. */
  channels?: string[];
  channelFamilies?: string[];
  hasDataRequirements: boolean;
  /** The registration carries a `channelsFromConfig` function. */
  hasChannelsFromConfig: boolean;
  /** The field paths the widget draws, as written. Undefined when absent or not a literal list. */
  fields?: string[];
  /** The registration or its `component` could not be read statically. */
  opaque?: string;
  /** A `// gonogo:augment-reads` marker above the registration: Topics only its built-in augment reads. */
  augmentReads?: AugmentReadsMarker;
}

export interface AugmentReadsMarker {
  augment: string;
  channels: string[];
  line: number;
}

/** A `registerAugment` call whose id and channels are literals. */
export interface AugmentRegistration {
  id: string;
  channels: string[];
  file: string;
  line: number;
}

/** A literal slot id a `registerContribution` or `registerAugment` call names. */
export interface SlotUse {
  kind: "contribution" | "augment";
  slot: string;
  /** The contribution's or augment's id, when it is a literal. */
  id?: string;
  file: string;
  line: number;
}

export interface WidgetScan {
  registration: Registration;
  reads: ReadRecord[];
  commands: ReadRecord[];
  unresolved: UnresolvedRecord[];
  readsFromConfig: boolean;
}

/** A hook from a published package that its reads index does not describe. */
export interface IndexMissingRecord {
  name: string;
  specifier: string;
  file: string;
  line: number;
  reason: string;
}

export interface ClientScan {
  widgets: WidgetScan[];
  /** Prefixes the client registers itself with `registerDynamicTopicPrefix("...")`. */
  registeredPrefixes: string[];
  indexMissing: IndexMissingRecord[];
  directives: DirectiveRecord[];
  augments: AugmentRegistration[];
  /** The literal slot ids the client's own source binds. */
  slotUses: SlotUse[];
  /**
   * Every slot id a registration can name: those the sdk declares, those the
   * client declares for its own widgets, in full. Empty when the sdk's types
   * could not be read, in which case no slot is judged.
   */
  knownSlots: string[];
  /** Type errors in the program, which can hide a read. */
  typeErrors: number;
  /** How many of the client's own source files the scan read. None means it looked in the wrong place. */
  sourceFiles: number;
}
