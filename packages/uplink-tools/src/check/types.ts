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
  check(ctx: CheckContext): FixableFinding[];
}

export interface ReadRecord {
  /** A Topic id or a command id when the read is exact. */
  id?: string;
  /** A family pattern such as `fleet.<vessel>.contact`. */
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
  /** Type errors in the program, which can hide a read. */
  typeErrors: number;
}
