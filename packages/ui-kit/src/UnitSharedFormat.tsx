import type { Value } from "@ksp-gonogo/sitrep-sdk";
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useId,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { magnitudeOf } from "./magnitude";
import {
  type FormatQuantityOptions,
  type FormatsFor,
  type FormatsForKind,
  formatGroupKey,
  type KindOfGroup,
  type LadderPosition,
  ladderPosition,
  type PresentableAs,
  type PresentableAsKind,
  pinGroupKey,
  readsAsOneFigure,
  separatingDecimals,
  type UnitGroupKey,
  unitScaleKey,
} from "./units";

/**
 * What a group settles, and what every member inside it is written at. The fields are the formatter's own, so applying one is a spread.
 *
 * An absent field is a group with no opinion: the member's own props fill it.
 *
 * @category Unit
 */
export interface SharedFormat {
  /** The rung every member is written at. */
  readonly format?: string;
  /** The unit every member is converted to, when the scope asked for one. */
  readonly as?: string;
  /** The digit count every member is written at. */
  readonly decimals?: number;
}

/** What one member hands over, and the whole of it. */
interface Report {
  /** Its reading, in the unit it arrived in. */
  readonly reading: number;
  readonly unit: string;
  /** Where it sits on the shared ladder, or undefined when its unit climbs nothing; such a member still reports for the digit count. */
  readonly position?: LadderPosition;
}

/**
 * What a scope pins for one group, typed by the unit it is addressed to: `of="m" as="kg"` is a compile error.
 *
 * @category Unit
 */
export interface UnitPins<Unit extends string = string> {
  /** The rung every member of the group is written at. */
  format?: FormatsFor<Unit>;
  /** The unit every member of the group is shown in. */
  as?: PresentableAs<Unit>;
  /** The digit count every member of the group is written at. */
  decimals?: number;
}

/**
 * {@link UnitPins} addressed to a whole group, checked against what that group measures.
 *
 * @category Unit
 */
export interface UnitGroupPins<Group extends UnitGroupKey> {
  /** The rung every member of the group is written at. */
  format?: FormatsForKind<KindOfGroup<Group>>;
  /** The unit every member of the group is shown in. */
  as?: PresentableAsKind<KindOfGroup<Group>>;
  /** The digit count every member of the group is written at. */
  decimals?: number;
}

/**
 * What each named group of a mixed scope is pinned to. Every entry is optional and a key that is not a group is a compile error. An Uplink's units reach this type by merging into `UnitDeclarations`.
 *
 * @category Unit
 */
export type UnitPinsByGroup = {
  [Group in UnitGroupKey]?: UnitGroupPins<Group>;
};

const NO_PINS: UnitPins = {};

/** What a scope was ASKED for, as against what it settles. */
interface Policy {
  /** What each named group was pinned to, by its {@link formatGroupKey}. A missing key settles for itself. */
  readonly byKey: ReadonlyMap<string, UnitPins>;
  /** A pin that named no unit, which reaches every group in the scope. */
  readonly unaddressed: UnitPins | undefined;
  /** Widen digits until the members read apart. A property of the whole scope. */
  readonly separate: boolean;
}

const NO_POLICY: Policy = {
  byKey: new Map(),
  unaddressed: undefined,
  separate: false,
};

/** Where every scope of one tree keeps what the whole tree shares. */
interface Root {
  /** Every scope of this tree, so a report in one can re-settle the others, sibling subtrees included. */
  readonly family: Set<Scope>;
  /** Subscribe to every settle in the tree. A bound function, never a method. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Re-settle every scope for `key`, and notify once if anything moved. */
  readonly sweep: (key: string) => void;
}

interface Scope {
  readonly root: Root;
  /** How far inside the tree this scope is: parents settle before children. */
  readonly depth: number;
  /** Put or drop one member's report under `key`. `undefined` drops it. */
  hold(key: string, id: string, report: Report | undefined): void;
  /** What `key` settled on, or undefined while the group has no opinion. */
  settled(key: string): SharedFormat | undefined;
  /** Whether `key`'s members all print as the same text at what it settled on. Kept apart from the format so the formatter is never handed a non-format field. */
  readsAsOneFigure(key: string): boolean;
  /** State what this scope was asked for. Its own props, never an answer. */
  setPolicy(next: Policy): void;
  /** Recompute this scope's answer for `key`. True when it moved. */
  resettle(key: string): boolean;
  /** Join the tree, or leave it once unmounted. Both halves, because strict mode runs a layout effect's cleanup and then its body again on one mount. */
  attach(): void;
  detach(): void;
}

function samePins(a: UnitPins | undefined, b: UnitPins | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.format === b.format && a.as === b.as && a.decimals === b.decimals;
}

function samePolicy(a: Policy, b: Policy): boolean {
  if (a.separate !== b.separate) return false;
  if (!samePins(a.unaddressed, b.unaddressed)) return false;
  if (a.byKey.size !== b.byKey.size) return false;
  for (const [key, pins] of a.byKey) {
    if (!samePins(pins, b.byKey.get(key))) return false;
  }
  return true;
}

/** The policy a scope's props amount to. {@link samePolicy} compares by field, so a fresh literal every render settles nothing extra. */
function policyOf(
  of: string | undefined,
  pins: UnitPinsByToken | undefined,
  own: UnitPins,
  separate: boolean,
): Policy {
  const byKey = new Map<string, UnitPins>();
  if (of !== undefined) byKey.set(formatGroupKey(of), own);
  for (const [token, pin] of Object.entries(pins ?? {})) {
    if (pin !== undefined) byKey.set(pinGroupKey(token), pin);
  }
  return {
    byKey,
    unaddressed: of === undefined && pins === undefined ? own : undefined,
    separate,
  };
}

function sameFormat(
  a: SharedFormat | undefined,
  b: SharedFormat | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.format === b.format && a.as === b.as && a.decimals === b.decimals;
}

function sameReport(a: Report | undefined, b: Report): boolean {
  return (
    a !== undefined &&
    a.reading === b.reading &&
    a.unit === b.unit &&
    a.position?.base === b.position?.base &&
    a.position?.rung === b.position?.rung
  );
}

function createRoot(): Root {
  const family = new Set<Scope>();
  const listeners = new Set<() => void>();
  return {
    family,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    sweep(key) {
      // Outermost first: a child's answer is built on its parent's.
      const ordered = [...family].sort((a, b) => a.depth - b.depth);
      let moved = false;
      for (const member of ordered) {
        if (member.resettle(key)) moved = true;
      }
      if (!moved) return;
      for (const listener of listeners) listener();
    },
  };
}

function createScope(parent: Scope | undefined): Scope {
  const held = new Map<string, Map<string, Report>>();
  const settled = new Map<string, SharedFormat>();
  const oneFigure = new Set<string>();
  const root = parent?.root ?? createRoot();
  let policy = NO_POLICY;

  /** The rung of the LARGEST member, the one the group is a group about. */
  const ownRung = (members: Iterable<Report>): string | undefined => {
    let winner: LadderPosition | undefined;
    for (const member of members) {
      const position = member.position;
      if (position === undefined) continue;
      if (winner === undefined || position.base > winner.base)
        winner = position;
    }
    return winner?.rung;
  };

  const scope: Scope = {
    root,
    depth: parent === undefined ? 0 : parent.depth + 1,

    hold(key, id, report) {
      const forKey = held.get(key);
      if (report === undefined) {
        if (forKey !== undefined) {
          forKey.delete(id);
          if (forKey.size === 0) held.delete(key);
        }
      } else {
        if (sameReport(forKey?.get(id), report)) return;
        if (forKey === undefined) held.set(key, new Map([[id, report]]));
        else forKey.set(id, report);
      }
      // Up first, so the outermost scope holds every reading in the tree; only it sweeps, once, for the whole family.
      if (parent === undefined) root.sweep(key);
      else parent.hold(key, id, report);
    },

    settled: (key) => settled.get(key),

    readsAsOneFigure: (key) => oneFigure.has(key),

    setPolicy(next) {
      if (samePolicy(policy, next)) return;
      policy = next;
      // Every key, not only pinned ones: `separate` is scope-wide, and a pin moving off a key lets that key settle for itself again.
      for (const key of held.keys()) root.sweep(key);
    },

    resettle(key) {
      const members = [...(held.get(key)?.values() ?? [])];
      const inherited = parent?.settled(key);
      // An unaddressed pin applies only where no group was named.
      const pins = policy.byKey.get(key) ?? policy.unaddressed ?? NO_PINS;
      const format = pins.format ?? inherited?.format ?? ownRung(members);
      const as = pins.as ?? inherited?.as;
      const decimals =
        pins.decimals ??
        (policy.separate
          ? separatingDecimals(members, { format, as })
          : inherited?.decimals);
      const next =
        format === undefined && as === undefined && decimals === undefined
          ? undefined
          : {
              ...(format !== undefined && { format }),
              ...(as !== undefined && { as }),
              ...(decimals !== undefined && { decimals }),
            };
      // Asked after the ladder, about the figures that will actually be drawn, and only by a scope asked to `separate`.
      const oneFigureNow =
        policy.separate && readsAsOneFigure(members, { format, as, decimals });
      const oneFigureMoved = oneFigureNow !== oneFigure.has(key);
      if (oneFigureNow) oneFigure.add(key);
      else oneFigure.delete(key);
      if (sameFormat(settled.get(key), next)) return oneFigureMoved;
      if (next === undefined) settled.delete(key);
      else settled.set(key, next);
      return true;
    },

    attach() {
      root.family.add(scope);
    },

    detach() {
      root.family.delete(scope);
    },
  };

  root.family.add(scope);
  return scope;
}

/** The inert default: a `<Unit>` with no scope above it reports into this and hears nothing back. */
const NO_SCOPE: Scope = {
  root: { family: new Set(), subscribe: () => () => {}, sweep: () => {} },
  depth: 0,
  hold: () => {},
  settled: () => undefined,
  readsAsOneFigure: () => false,
  setPolicy: () => {},
  resettle: () => false,
  attach: () => {},
  detach: () => {},
};

// The scope's identity never changes, and answers reach members through `useSyncExternalStore`, so a settle never re-runs a member's report effect.
const ScopeContext = createContext<Scope>(NO_SCOPE);

/**
 * Whether there is a real `<UnitSharedFormat>` above this point.
 *
 * Membership cannot be read off {@link useSharedFormat}: a group over a unit with no ladder (`rpm`) legitimately settles an empty format.
 */
export function useInSharedFormat(): boolean {
  return useContext(ScopeContext) !== NO_SCOPE;
}

/** What every spelling of the props below shares. */
interface UnitSharedFormatBaseProps {
  children?: ReactNode;
  /**
   * Widen the digit count until the members stop printing the same figure as each other. What an interval wants (6 700 km and 6 710 km both print `6.7 Mm` otherwise) and a column does not. Applies to the whole scope.
   */
  separate?: boolean;
}

/**
 * A scope that pins one kind. `of` names the unit the pins are addressed to and types them: `of="m"` makes `as` a length and `format` a rung on the length ladder, and `of={v.unit}` needs no annotation.
 *
 * Without `of` the pins are unaddressed: they reach every group and nothing checks them.
 *
 * @category Unit
 */
export interface UnitSharedFormatProps<Unit extends string = string>
  extends UnitSharedFormatBaseProps,
    UnitPins<Unit> {
  /** The unit the pins below are addressed to. */
  of?: Unit;
}

/**
 * A scope that pins several groups, each keyed by name, so a group is pinned at most once and one that needs nothing is simply absent: `pins={{ length: { as: "km" }, mass: { as: "t" } }}`.
 *
 * Each value is typed by its own key, so `{ length: { as: "kg" } }` is a compile error at that entry. A laddered kind is keyed by its kind; a unit that climbs nothing keys itself, so `s` and `min` stay separate groups. See {@link UnitGroupKey}.
 *
 * @category Unit
 */
export interface UnitSharedFormatMixedProps extends UnitSharedFormatBaseProps {
  /** What each named group is pinned to, checked against what it measures. */
  pins: UnitPinsByGroup;
}

/** The pin map with its keys erased, as the runtime reads it. */
type UnitPinsByToken = Readonly<Record<string, UnitPins | undefined>>;

/** Both spellings at once, as the component body actually reads them. */
interface UnitSharedFormatAnyProps extends UnitSharedFormatBaseProps, UnitPins {
  of?: string;
  pins?: UnitPinsByToken;
}

/**
 * A group of quantities that settles one format per kind, so the whole group reads as one instrument. It renders nothing of its own, so it can wrap a row, a cell, a table or a widget body.
 *
 * Every `<Unit>` inside reports its reading and is given back the settled format; outside a scope each value formats itself. The caller names no rung, unit or digit count.
 *
 * - The rung is the largest member's, since a group reads at the size of the thing it describes: `999 m` beside `1000 m` reads `1.0 km`, and a group that must tell its members apart says `separate`
 * - Grouping is per kind (per ladder family, else per unit), so metres settle with metres and kilograms with kilograms in one scope
 * - `format`, `as` and `decimals` pin what a group would otherwise settle. `of` addresses them to one group (`of="m" as="km"`), `pins` to several (`pins={{ length: { as: "km" }, mass: { as: "t" } }}`), and a pin that names no unit reaches every group unchecked
 * - Nested scopes compose: the rung comes from the outermost, the digit count from the nearest scope that asked for one. Two scopes side by side are two groups
 *
 * The first pass draws each member at its own ladder; reports land in layout effects and the settled format re-renders before paint, so the reader never sees the unsettled pass.
 *
 * @example
 * ```tsx
 * // Current over limit, one rung, symbol drawn once: "1234/2000 rpm".
 * <UnitSharedFormat>
 *   <Unit value={currentRpm} decimals={0} hideUnitInGroup />
 *   /
 *   <Unit value={rpmLimit} decimals={0} />
 * </UnitSharedFormat>
 *
 * // An interval whose ends must read apart.
 * <UnitSharedFormat separate>
 *   <Unit value={low} /> to <Unit value={high} />
 * </UnitSharedFormat>
 *
 * // Every length in a table shown in km.
 * <UnitSharedFormat of="m" as="km">
 *   {rows}
 * </UnitSharedFormat>
 * ```
 *
 * @category Unit
 */
export function UnitSharedFormat<Unit extends string = string>(
  props: UnitSharedFormatProps<Unit> | UnitSharedFormatMixedProps,
): ReactElement;
export function UnitSharedFormat({
  children,
  of,
  pins,
  format,
  as,
  decimals,
  separate = false,
}: UnitSharedFormatAnyProps): ReactElement {
  const enclosing = useContext(ScopeContext);
  // The inert default is not a parent: its root never sweeps.
  const [scope] = useState(() =>
    createScope(enclosing === NO_SCOPE ? undefined : enclosing),
  );
  useLayoutEffect(() => {
    scope.attach();
    return () => scope.detach();
  }, [scope]);
  // After the members' own effects, which React runs child-first, so the reports are in before the policy that reads them.
  useLayoutEffect(() => {
    scope.setPolicy(policyOf(of, pins, { format, as, decimals }, separate));
  }, [scope, of, pins, format, as, decimals, separate]);
  return (
    <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>
  );
}

/**
 * Report a quantity to the enclosing {@link UnitSharedFormat} and hear back the format its group settled on, or `undefined` when there is none.
 *
 * `<Unit>` calls this itself. It is published for readouts `<Unit>` cannot draw (SVG axis text, an `aria-valuetext`) that must be written at the same format as the `<Unit>`s beside them. A quantity whose caller already decided its presentation (`format`, `as`, a non-auto `scale`) neither reports nor hears back.
 */
export function useSharedFormat<Unit extends string = string>(
  value: Value<Unit> | null | undefined,
  opts: FormatQuantityOptions = {},
): SharedFormat | undefined {
  const scope = useContext(ScopeContext);
  const id = useId();
  const reading = magnitudeOf(value);
  const unit: string | undefined = value?.unit;
  const decided =
    opts.format !== undefined ||
    opts.as !== undefined ||
    (opts.scale !== undefined && opts.scale !== "auto");
  const key = decided || reading === null ? undefined : formatGroupKey(unit);
  // Two numbers rather than the value, so the effect depends on the reading and not on an object that is fresh every render.
  const position =
    key === undefined ||
    reading === null ||
    unit === undefined ||
    unitScaleKey(unit) === undefined
      ? undefined
      : ladderPosition(reading, unit);
  const base = position?.base;
  const rung = position?.rung;

  useLayoutEffect(() => {
    if (key === undefined || reading === null || unit === undefined) return;
    scope.hold(key, id, {
      reading,
      unit,
      ...(base !== undefined &&
        rung !== undefined && { position: { base, rung } }),
    });
    return () => scope.hold(key, id, undefined);
    // The format this hook returns is deliberately absent from these deps: a report that depended on the answer would loop.
  }, [scope, id, key, reading, unit, base, rung]);

  return useSyncExternalStore(
    scope.root.subscribe,
    () => (key === undefined ? undefined : scope.settled(key)),
    () => undefined,
  );
}

/**
 * Whether the group this value belongs to reads as one figure at the format it settled on. Only a scope asked to `separate` answers true.
 *
 * Read-only, unlike {@link useSharedFormat}: a caller that decides what to draw from this must keep reporting as before, or membership becomes a function of the verdict.
 */
export function useReadsAsOneFigure<Unit extends string = string>(
  value: Value<Unit> | null | undefined,
  opts: FormatQuantityOptions = {},
): boolean {
  const scope = useContext(ScopeContext);
  const decided =
    opts.format !== undefined ||
    opts.as !== undefined ||
    (opts.scale !== undefined && opts.scale !== "auto");
  const key =
    decided ||
    magnitudeOf(value) === null ||
    value === null ||
    value === undefined
      ? undefined
      : formatGroupKey(value.unit);
  return useSyncExternalStore(
    scope.root.subscribe,
    () => (key === undefined ? false : scope.readsAsOneFigure(key)),
    () => false,
  );
}
