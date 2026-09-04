/**
 * Data for the published-doc-reachability ratchet
 * (`published-doc-reachability.test.ts`). Pure data module, no test logic, so
 * the shrink-only check can load this file's content at an arbitrary git ref
 * without pulling in vitest or the scan machinery. Same split-module shape as
 * `uplink-isolation.allowlist.ts`.
 *
 * THE RULE: a doc comment on the PUBLISHED surface may not tell a third-party
 * author to reach for something no published barrel exports.
 *
 * `uplink-isolation` checks imports and `uplink-boundary` checks the other
 * direction, and both are blind to this: a doc comment is not a reference, so
 * an instruction pointing at a private symbol passes every existing gate. The
 * two motivating cases were `<Countdown>`'s doc telling an author to "subtract
 * the frame's view time first (`useViewUt`)" while `useViewUt` was unexported,
 * and `IPropagationProvider` advertising an extension point from an assembly
 * nobody outside could reference. Both are fixed; neither was found by a gate.
 *
 * FIVE PREDICATES, all structural. A violation is a reference where all five
 * hold:
 *
 * 1. LOCATION. Inside a doc comment attached to a declaration exported from a
 *    published barrel, or to one of its members. C#: a public type in
 *    `Sitrep.Contract` or an `<Uplink>.Contract` slice. A comment on an
 *    internal file is a note to us and is out of scope.
 * 2. FORM. Code form only: `` `X` `` or `{@link X}`; `<see cref>` or `<c>` in
 *    C#. A prose mention is not a reference.
 * 3. REACHABILITY. The head identifier resolves to a symbol declared in this
 *    repo and is exported by no published barrel. A name resolving to nothing
 *    is a STALE doc, a different bug, and out of scope: `useDataValue` appears
 *    19 times in the sdk and every one is "the retired `useDataValue` shim".
 * 4. TIER. See `TIERS`. T3 (`packages/app`, `sitrep-server`, the C# host
 *    assemblies) is excluded, because nobody can import those at all, so a
 *    reference to one is provenance by construction. That cut is what keeps the
 *    seed at 59 instead of 129 and keeps the gate off documentation whose whole
 *    job is to say where a wire value came from.
 * 5. QUALIFIED REFERENCES PASS. If the doc says where the named thing lives,
 *    within `QUALIFY_WINDOW` characters either side of the reference and with
 *    no other reference standing between the two, it is provenance.
 *
 * Predicate 5 is the escape valve, and it is deliberately NOT the default fix.
 * Qualifying "`useDataSeries`" into "`@ksp-gonogo/data`'s `useDataSeries`"
 * clears the gate while leaving the reader worse off: they now know there is a
 * named, homed thing that would apparently help and that they cannot install.
 * 34 references were qualified on 2026-09-01 and every one was rewritten out
 * again the same day. Reach for it only where the mention is pure provenance
 * the reader benefits from knowing and could not act on either way.
 *
 * ATTACHMENT IS PER-REFERENCE, not per-neighbourhood, because a qualifier
 * otherwise launders the references beside it: the `@ksp-gonogo/components`
 * written for `formatDensity` in `NullValue.tsx` also marked a ui-kit-internal
 * `formatKspDate` two mentions earlier as provenance, with that doc untouched.
 *
 * A LEXICAL DISCRIMINATOR WAS BUILT, MEASURED AND REJECTED. The obvious rule is
 * an instruction verb within N characters before the reference. It catches the
 * true positive ("Subtract" sits 30 characters before `useViewUt`) and on live
 * code at N=30 produces 6 hits of which all 6 are false: "call **sites**",
 * "callers that can't **use** hooks", "the legacy `getLatestValue(...)`
 * **read**". Requiring the reference to be the verb's direct object fixes all
 * six and loses the true positive, because `useViewUt` appears as a
 * parenthetical gloss. 0 of 6 either way. Do not re-derive it: a gate that
 * fires on "call sites" is a gate that gets turned off.
 *
 * Every entry in `DOC_DEBT` and `CS_CAPABILITY_SEAM_DEBT` is DEBT and both
 * lists are SHRINK-ONLY. Fix one by rewriting the sentence so it does not point
 * outside, by moving the named export onto a published barrel where the reader
 * genuinely needs it, or, in the narrow provenance case, by qualifying the
 * mention. Then lower the count. Never raise one.
 */

/**
 * Where the unreachable symbol actually lives. This grouping is the only one
 * that predicted whether a census finding was real, which is why it is a
 * predicate and not a report column.
 *
 * The three graded tiers are things an author could in principle be handed. T3
 * is not gated at all and has no entry here, because `packages/app`,
 * `sitrep-server` and the C# host assemblies are not installable by anyone: a
 * doc naming one is telling the reader where a value came FROM, which is
 * useful, and 59 of the census's 129 TS instances were exactly that.
 */
export const TIERS = {
  /**
   * The same published package, not in its own barrel. 20 seeded, every one an
   * internal implementation note ("`useHeaderAsideFit` reports content that
   * genuinely fits"). This is also the tier `useViewUt` sat in from the sdk's
   * own side, where it was harmless; the instance that hurt was cross-package.
   */
  T1a: "same published package, not in its barrel",
  /**
   * The OTHER published package, not in its barrel. The `useViewUt` cell
   * exactly, and the reason the number seeded here is 2 rather than 0 is a name
   * collision on the word `key`, not real content. Any growth here is the
   * original bug recurring.
   */
  T1b: "the other published package, not in its barrel",
  /**
   * A private npm workspace package. 37 seeded and the most interesting tier:
   * `BufferedDataSource`'s public doc said "callers use `queryRange` or the
   * `useDataSeries` hook", and `useDataSeries` lives in `@ksp-gonogo/data`,
   * which is `private: true`. Same shape as `useViewUt`, one notch softer
   * because it names an alternative rather than a required step.
   *
   * Cleared to zero on 2026-09-01 by rewriting all 34, not one of them by
   * moving an export: every one turned out to be provenance a reader of the
   * published surface has no use for, and `BufferedDataSource`'s own sentence
   * was already true with `queryRange` alone.
   */
  T2: "a private npm workspace package",
} as const;

export type Tier = keyof typeof TIERS;

/**
 * The published npm surfaces and their REAL entry points, which is what makes
 * predicate 3 trustworthy: exports are computed with the TypeScript checker's
 * `getExportsOfModule` over these files, so a re-export chain is followed
 * rather than guessed. An under-collecting barrel set would manufacture
 * findings and an over-collecting one would mask them.
 */
export const PUBLISHED_PACKAGES = [
  {
    name: "@ksp-gonogo/sitrep-sdk",
    dir: "mod/sitrep-sdk",
    entries: [
      "src/index.ts",
      "src/media/index.ts",
      "src/registry/index.ts",
      "src/spine/index.ts",
      "src/testing/index.ts",
    ],
  },
  {
    name: "@ksp-gonogo/ui-kit",
    dir: "packages/ui-kit",
    entries: [
      "src/index.ts",
      "src/testing.ts",
      "src/guards.ts",
      "src/render-probe.tsx",
      "src/render.ts",
    ],
  },
] as const;

/**
 * `private: true` workspace packages. An outside author cannot install one, so
 * a doc on the published surface naming one of their symbols is tier T2.
 *
 * Kept as an explicit list rather than read from each `package.json`, so that
 * flipping a package to published is a deliberate edit here. It is the same
 * hazard `FORBIDDEN_PACKAGES` has in `uplink-isolation.allowlist.ts`: a name
 * silently leaving the list makes the gate stop asking, and stopping asking
 * looks exactly like a clean repo.
 */
export const PRIVATE_NPM_PACKAGES = [
  "@ksp-gonogo/core",
  "@ksp-gonogo/components",
  "@ksp-gonogo/data",
  "@ksp-gonogo/ui",
  "@ksp-gonogo/logger",
  "@ksp-gonogo/sitrep-client",
  "@ksp-gonogo/test-utils",
  "@ksp-gonogo/serial",
  "@ksp-gonogo/sitrep-kernel",
] as const;

/**
 * Characters predicate 5 reads for a qualifier, back from a reference's START
 * and on from its END. Symmetric on purpose: measured forward from the start it
 * spent its budget on the reference's own characters and flagged "the read side
 * of `useDataSeries`'s stream shim (`@ksp-gonogo/data`)", where the specifier
 * sat one character past the end of the slice.
 */
export const QUALIFY_WINDOW = 90;

/**
 * Predicate 5 for TypeScript: does the doc say WHERE the named thing lives? A
 * package specifier, an assembly or namespace, a file path, or the informal
 * "the app's" / "mod-side" that this codebase already uses.
 *
 * Stored as `[source, flags]` rather than as `RegExp` literals so the
 * never-narrows check can compare two revisions of the list as data.
 */
export const TS_QUALIFIER_PATTERNS: readonly (readonly [string, string])[] = [
  ["@ksp-gonogo/[a-z-]+", "i"],
  ["\\b(?:Sitrep|Gonogo)\\.[A-Z][A-Za-z.]*", ""],
  ["\\bmod/[A-Za-z.]+", ""],
  ["\\bpackages/[a-z-]+", ""],
  [
    "\\b[A-Za-z][A-Za-z0-9_-]*/[A-Za-z][A-Za-z0-9_.-]*\\.(?:ts|tsx|cs|md)\\b",
    "",
  ],
  ["\\b[A-Za-z][A-Za-z0-9_-]*\\.(?:ts|tsx|cs)\\b", ""],
  ["\\bthe (?:app|mod|server|engine|host|kit)(?:'s)?\\b", "i"],
  ["\\b(?:app|mod|server|host|core)-side\\b", "i"],
];

/**
 * Predicate 5 for C#, and DELIBERATELY NARROWER than the TypeScript list: an
 * assembly name, a `mod/` path or a filename, and nothing informal.
 *
 * The informal patterns cannot mean anything here. Every doc comment in
 * `Sitrep.Contract` is about the mod, so "MOD-side" says where a computation
 * HAPPENS, not where a type LIVES. Reusing the TS list marks
 * `VesselTarget.cs`'s "computed MOD-side by the elected
 * `ITargetApproachSolver`" as qualified and drops the single most important
 * finding on this side of the tree, measured, before this list was split.
 */
export const CS_QUALIFIER_PATTERNS: readonly (readonly [string, string])[] = [
  ["\\b(?:Sitrep|Gonogo)\\.[A-Z][A-Za-z]*(?:\\.[A-Z][A-Za-z]*)*", ""],
  ["\\bmod/[A-Za-z.]+", ""],
  ["\\b[A-Za-z][A-Za-z0-9_-]*\\.cs\\b", ""],
];

/**
 * Assemblies an Uplink author cannot reference. `Sitrep.Contract` and each
 * `<Uplink>.Contract` slice are the published half; everything here is private,
 * so a contract doc naming one of its types fails predicate 3.
 */
export const CS_PRIVATE_ASSEMBLIES = [
  "Sitrep.Host",
  "Sitrep.Core",
  "Sitrep.Transport",
  "Sitrep.Propagation",
  "Sitrep.CaptureAnalysis",
  "Sitrep.Skeleton",
  "Gonogo.KSP",
] as const;

/**
 * Predicate 4's C# form, and it is NOT what the census claimed. The census said
 * "the named type is implementable (interface or abstract)" separates the 3 real
 * findings from the 62 provenance ones exactly. Measured on the tree, that
 * predicate finds ONE of the three: `ITargetApproachSolver` is an interface,
 * but `KeplerProvider` is a concrete class and the two findings naming it are
 * real. Widening it to "implements a published contract interface" catches all
 * three and 22 provenance mentions with them, because `ChannelEngine`
 * implements `IUplinkHost`.
 *
 * What actually separates them is the CAPABILITY SEAM. A type on one of these
 * is elected at runtime through the kernel, which is precisely the mechanism a
 * third-party backend plugs into, so a contract doc naming one is describing an
 * extension point to somebody who cannot see it. `ISitrepUplink`, `IUplinkHost`
 * and `ISnapshotSampler` are not elected and do not qualify, which is what
 * drops `PartsUplink`, `ChannelEngine` and `FlightLifecycleSampler`.
 *
 * Derived rather than listed: the scan reads `Kernel.Query<T>` / `Elect<T>` type
 * arguments out of the mod source, so a new capability joins the rule the day
 * its election is written. A hand-kept list would have to be remembered, and
 * the whole reason `ITargetApproachSolver` survived is that nobody remembered.
 *
 * The measurement: 65 private-assembly references in contract docs, 5 of them on
 * a capability seam, and those 5 are the census's 3 findings plus the
 * `StockActionGroupsBackend` borderline it flagged as fourth.
 */
export const CS_CAPABILITY_ELECTION_PATTERNS: readonly string[] = [
  "\\b(?:Query|Elect(?:Best)?)<\\s*(I[A-Za-z0-9_]*)\\s*>",
];

/**
 * PER-FILE and PER-TIER, never a single total. One file's fix must not pay for
 * another file's regression, and a T1b instance appearing while three T2 ones
 * are fixed is the original bug coming back under cover of progress.
 *
 * Seeded 2026-08-20 from the census: 59 references across 36 files, T1a 20,
 * T1b 2, T2 37. Maximum 6 in any one file.
 *
 * T2 IS EMPTY as of 2026-09-01. All 34 that were still standing were rewritten
 * so the published doc no longer names the symbol at all, and none of them
 * needed an export moved: they described how the app happens to consume a
 * published thing, which is not a reader of the sdk's business. A new T2 entry
 * is therefore a fresh violation, not seed residue.
 */
export const DOC_DEBT: Record<string, Partial<Record<Tier, number>>> = {
  "mod/sitrep-sdk/src/api/index.ts": { T1a: 1 },
  "mod/sitrep-sdk/src/api/logger.ts": { T1a: 1 },
  "mod/sitrep-sdk/src/flight/fixtureIO.ts": { T1a: 1 },
  "mod/sitrep-sdk/src/media/frame-delay.ts": { T1a: 1 },
  "mod/sitrep-sdk/src/media/shared-delayed-streams.ts": { T1a: 2 },
  "mod/sitrep-sdk/src/spine/context.tsx": { T1a: 1 },
  "mod/sitrep-sdk/src/testing/install-real-test-host.ts": { T1a: 1 },
  "mod/sitrep-sdk/src/testing/memory-storage.ts": { T1a: 1 },
  "mod/sitrep-sdk/src/testing/mock-data-source.ts": { T1a: 1 },
  "mod/sitrep-sdk/src/units.ts": { T1a: 2 },
  /** Both T1b entries are the word `key` colliding with an unrelated export. */
  "packages/ui-kit/src/ActionMenu.tsx": { T1b: 1 },
  "packages/ui-kit/src/CommandDelay/InFlightList.tsx": { T1a: 1 },
  "packages/ui-kit/src/CommandDelay/toInFlightListItems.ts": { T1a: 1 },
  "packages/ui-kit/src/NullValue.tsx": { T1a: 2 },
  "packages/ui-kit/src/Panel.tsx": { T1a: 1 },
  "packages/ui-kit/src/configEqual.ts": { T1b: 1 },
  "packages/ui-kit/src/formatDuration.ts": { T1a: 1 },
};

/**
 * The C# half, seeded at 5 references across 4 files and now down to 4 across 3.
 *
 * These are REAL and they are not this gate's to fix. All of them are the same
 * capability-seam bug the `IPropagationProvider` / `IManeuverPlanSource` /
 * `ICommandCentreSource` moves addressed on 2026-08-20.
 *
 * Seeding rather than fixing is also the sequence `uplink-isolation` and the
 * act-warning ratchet both used: the gate lands green, and the count falls as
 * the real work lands. `VesselTarget.cs` is the first entry to fall that way:
 * `ITargetApproachSolver` was the seam the census existed to find, and it moved
 * to `Sitrep.Contract` on 2026-08-20 along with the capability id an implementor
 * has to name to register (`TargetApproachCapability.CapabilityId`). The type is
 * reachable now, so the reference is not a violation and the entry is gone
 * rather than lowered.
 *
 * - `IPropagationProvider.cs` crefs `KeplerProvider`, in `Sitrep.Propagation`.
 *   Residue of the original bug: the interface moved to the contract, the cref
 *   pointing into the private assembly did not.
 * - `PropagationTarget.cs` names `KeplerProvider` normatively, twice: "the same
 *   Z-up inertial convention `KeplerProvider` emits" is a requirement stated
 *   only by reference to code the implementer cannot read.
 * - `ActionGroupsBackend.cs` names `StockActionGroupsBackend`, in `Gonogo.KSP`.
 *   Informative rather than instructive, but it is the first-party
 *   implementation of a third-party extension point, so it is the one a new
 *   backend author would most want to read.
 */
export const CS_CAPABILITY_SEAM_DEBT: Record<string, number> = {
  "mod/Sitrep.Contract/ActionGroupsBackend.cs": 1,
  "mod/Sitrep.Contract/IPropagationProvider.cs": 1,
  "mod/Sitrep.Contract/PropagationTarget.cs": 2,
};

/**
 * Names that are not repo symbols even when a repo symbol shares the spelling.
 * Predicate 3 resolves the head identifier against an index of exported
 * declarations, and without this list every `` `Map` ``, `` `Record` `` and
 * `` `useMemo` `` in a doc comment becomes a candidate.
 */
export const GLOBAL_IDENTIFIERS: readonly string[] = [
  // JS / TS builtins and utility types
  "Array",
  "Object",
  "String",
  "Number",
  "Boolean",
  "Symbol",
  "BigInt",
  "Math",
  "JSON",
  "Date",
  "RegExp",
  "Error",
  "TypeError",
  "RangeError",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Promise",
  "Proxy",
  "Reflect",
  "Function",
  "Infinity",
  "NaN",
  "undefined",
  "null",
  "true",
  "false",
  "void",
  "any",
  "unknown",
  "never",
  "Partial",
  "Required",
  "Readonly",
  "Record",
  "Pick",
  "Omit",
  "Exclude",
  "Extract",
  "NonNullable",
  "ReturnType",
  "Parameters",
  "Awaited",
  "InstanceType",
  "Uint8Array",
  "ArrayBuffer",
  "DataView",
  "Float32Array",
  "Float64Array",
  "Int32Array",
  "Iterable",
  "Iterator",
  "AsyncIterable",
  "Generator",
  "TemplateStringsArray",
  // Host and DOM globals
  "console",
  "globalThis",
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "fetch",
  "Response",
  "Request",
  "Headers",
  "URL",
  "URLSearchParams",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "queueMicrotask",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "structuredClone",
  "performance",
  "crypto",
  "Blob",
  "File",
  "FileReader",
  "WebSocket",
  "EventTarget",
  "Event",
  "CustomEvent",
  "AbortController",
  "AbortSignal",
  "MessageChannel",
  "IntersectionObserver",
  "ResizeObserver",
  "MutationObserver",
  "IDBDatabase",
  "IDBFactory",
  "indexedDB",
  "Worker",
  "OffscreenCanvas",
  "ImageBitmap",
  "HTMLElement",
  "HTMLDivElement",
  "HTMLInputElement",
  "HTMLCanvasElement",
  "HTMLVideoElement",
  "SVGElement",
  "SVGSVGElement",
  "Element",
  "Node",
  "NodeList",
  "CanvasRenderingContext2D",
  "MediaStream",
  "MediaStreamTrack",
  "RTCPeerConnection",
  "VideoFrame",
  "EncodedVideoChunk",
  "process",
  "Buffer",
  "require",
  "module",
  // React and styled-components
  "React",
  "ReactNode",
  "ReactElement",
  "JSX",
  "FC",
  "PropsWithChildren",
  "CSSProperties",
  "RefObject",
  "MutableRefObject",
  "Dispatch",
  "SetStateAction",
  "useState",
  "useEffect",
  "useLayoutEffect",
  "useMemo",
  "useCallback",
  "useRef",
  "useContext",
  "useReducer",
  "useId",
  "useSyncExternalStore",
  "createContext",
  "createPortal",
  "forwardRef",
  "memo",
  "StrictMode",
  "Fragment",
  "Suspense",
  "ThemeProvider",
  "styled",
  "css",
  "keyframes",
  // Keywords that reach the scan as a backticked head identifier
  "this",
  "if",
  "else",
  "for",
  "while",
  "return",
  "function",
  "class",
  "const",
  "let",
  "var",
  "import",
  "export",
  "from",
  "as",
  "default",
  "new",
  "typeof",
  "number",
  "string",
  "boolean",
  "object",
  "symbol",
  "bigint",
];

/**
 * The reconstruction the gate proves itself against. `useViewUt` is exported
 * from the sdk barrel today, so the bug cannot be observed live and the
 * instrument has to be validated against a rebuilt instance of it.
 *
 * `Countdown.tsx`'s doc for `CountdownProps.durationS` says to "Subtract the
 * frame's view time first (`useViewUt`)". With `useViewUt` deleted from the
 * computed barrels, that sentence is the T1b violation the whole gate exists to
 * catch, and the check that plants it fails LOUDLY if the scan cannot see it.
 * A scan that finds nothing reports a clean repo, and a broken path, a renamed
 * entry point or a regex that stopped matching all look exactly like success.
 */
export const RECONSTRUCTION = {
  symbol: "useViewUt",
  declaredIn: "@ksp-gonogo/sitrep-sdk",
  file: "packages/ui-kit/src/Countdown.tsx",
  tier: "T1b",
} as const;
