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
  formatGroupKey,
  type LadderPosition,
  ladderPosition,
  type PresentableAs,
  separatingDecimals,
  unitScaleKey,
} from "./units";

/**
 * A group of quantities that settles ONE format per kind, so the whole group
 * reads as one instrument.
 *
 * ```tsx
 * <UnitSharedFormat separate>
 *   <Unit value={low} /> – <Unit value={high} />
 * </UnitSharedFormat>
 * ```
 *
 * The ladder is right for a value on its own and wrong for a value beside
 * another one. Two ends of an interval laddering independently print
 * `999 m – 1.0 km`: one interval, two units, and a width the reader has to
 * convert in their head before they can see it. A column of a table is the same
 * failure spread vertically, and the fix in both cases is that the members stop
 * deciding individually.
 *
 * ## Nobody threads anything
 *
 * The members REPORT and the group DECIDES. Every `<Unit>` inside a scope hands
 * over its reading, and is given back the format the group settled on; outside
 * a scope the hook is inert and each value answers for itself, exactly as it
 * did before this existed. So a caller WRAPS and is finished: it names no
 * reference value, no rung, no unit and no digit count, and it cannot forget to
 * at one of the sites.
 *
 * A report carries no formatted text, which is what keeps the ladder in one
 * place: `ladderPosition` in `units.ts` runs it, `separatingDecimals` in
 * `units.ts` answers the digit count, and this file only decides which answers
 * apply to whom.
 *
 * That is the difference from {@link quantityScale}, which is still the right
 * tool where it applies. A moving-scale instrument HAS a reference: the top of
 * the strip is the axis, and every mark on it is below that by construction. A
 * band has two ends and no axis, and a table column has N cells and no axis, so
 * there is nothing for a caller to nominate.
 *
 * ## A FORMAT, not just a rung
 *
 * A rung was the first thing a group had to settle and it is not the only one.
 * How many digits it takes for two readings to stop printing the same figure is
 * a function of ALL the members, exactly as the rung is, so it belongs to the
 * group too. A caller that computed it for itself would be a second formatter
 * standing beside `<Unit>`, which is the thing `<Unit>` exists to be the only
 * one of. {@link SharedFormat} is therefore open: what a group settles can grow
 * without a caller learning anything new.
 *
 * ## The rung is the SMALLEST member's, not the largest
 *
 * A group rung may not round a member away. `999 m` and `1000 m` settle on
 * metres and read `999 m – 1000 m`; settling on kilometres instead would print
 * the interval as `1.0 km – 1.0 km` and need decimals bolted back on to say
 * anything at all. Taken to a column, the largest member's rung is worse still:
 * one 3.4 Mm reading would render a 500 m one as `0.0 Mm`, which is not a
 * reading.
 *
 * A member of exactly zero is unharmed by any rung and is left out of the
 * choice. Otherwise a single zero, which is a common reading rather than a rare
 * one, would drag every group it appeared in to the bottom of its ladder.
 *
 * ## One format per KIND, and a PIN is addressed to one of them
 *
 * Grouping is per kind, so a mixed scope works: metres settle with metres and
 * kilograms with kilograms, in the same group, with no caller separating them.
 * The key is a FAMILY where a unit declares one, because bits and bytes share
 * the data dimension and must not share rungs, and it falls back to the unit
 * itself where nothing climbs at all: see `formatGroupKey` in `units.ts`.
 *
 * What a scope PINS is per kind for the same reason. A scope told to read in
 * kilometres is saying something about its lengths and nothing about its
 * masses, so it names the unit it is talking about and the pin reaches that
 * group alone. One kind names it with `of` and pins flat; several name each one
 * in a map keyed by unit:
 *
 * ```tsx
 * <UnitSharedFormat of="m" as="km">
 * <UnitSharedFormat pins={{ m: { as: "km" }, kg: { as: "t" } }}>
 * ```
 *
 * Naming the unit is also the whole of how a pin comes to be TYPED. `of="m"`
 * makes `as` a length, and a key of `m` types its own entry, so `as="kg"` over
 * lengths is a compile error rather than a request dropped on the floor.
 *
 * A scope that pins without naming a unit is the one case left over, and its
 * pin reaches EVERY group, because an instruction that names no kind cannot be
 * addressed to one. That is what every pin did before, and it was not merely
 * ignored: a scope pinned to `format="km"` handed that rung to its KILOGRAMS
 * too, where the formatter refused the cross-kind pin but had already displaced
 * the rung the mass group settled for itself, and 500 kg beside 1 000 000 kg
 * rendered as `500.00 kg` and `1.00 kt`. One group, two units, which is the
 * failure this whole component exists to prevent.
 *
 * ## Nesting COMPOSES rather than divides
 *
 * A `<Band>` carries its own scope, and a column of bands wants its rung
 * settled down the column rather than per row. So a report reaches every scope
 * above it, the rung comes from the OUTERMOST one, and the digit count comes
 * from the nearest scope that asked for one. A band inside an aligned column
 * therefore reads in the column's unit while still separating its own two ends.
 * Splitting a group deliberately means not nesting: two scopes side by side are
 * two groups.
 *
 * ## Two passes, and why it cannot loop
 *
 * A member cannot know the group format on the first pass, because the group is
 * not assembled until its members have rendered. So the first pass draws each
 * member at its own ladder, the reports land in layout effects, and a changed
 * group format re-renders the scope. Layout effects run before the browser
 * paints, so the corrected format is in the first frame a reader sees and there
 * is no flicker.
 *
 * It settles in exactly one extra pass, and the reason is structural rather
 * than a matter of luck: **what a member reports is a function of its own props
 * alone.** The format pushed back is never an input to a report, so the second
 * pass reproduces the first pass's reports exactly, the settled format comes
 * out the same, and nothing further is scheduled. Three things keep that true
 * and are worth knowing before editing:
 *
 * - a member's report effect does NOT depend on the format it was given back.
 *   Its deps are the scope and its own reading, and the scope's identity never
 *   changes, which is why the answer reaches members through
 *   `useSyncExternalStore` rather than through the context value. A context
 *   value that changed identity per settle would re-run every member's effect,
 *   whose cleanup drops its entry and whose body puts it back, and a drop that
 *   moves the group format schedules another settle. That is an infinite loop,
 *   and it is the one this shape exists to make unwritable
 * - a scope's POLICY is its own props, so it is not derived from any answer
 *   either. It lands in a layout effect of the provider's, which React runs
 *   after its children's, so the reports are in before the policy that reads
 *   them and both are in before the browser paints
 * - the store notifies only when a settled format actually CHANGES, and hands
 *   back the SAME object until it does. A scope of thirty cells re-renders when
 *   the group's answer moves and stays still through every frame that does not
 *   move it
 *
 * Hysteresis is deliberately not wired in here. `formatQuantity` can hold a
 * rung across a boundary and doing that for a group would make the output an
 * input, which is exactly the property above. It is also not needed yet: a lone
 * `<Unit>` has no memory either, so a group that held one would behave unlike
 * every readout beside it.
 */

/**
 * What a group settles, and what every member inside it is written at.
 *
 * The fields are exactly the formatter's own, so applying one is a spread
 * rather than a translation, and a field added to the group later needs no new
 * plumbing at the member.
 *
 * An ABSENT field is a group with no opinion, not an opinion of "default": the
 * member's own props fill it, and below them the kind's. That is what lets a
 * scope settle a rung for a column while leaving each cell's digits alone.
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
  /**
   * Where it sits on the shared ladder, or undefined when its unit climbs
   * nothing. A unit with no ladder still has a digit count to settle, which is
   * why such a member reports at all.
   */
  readonly position?: LadderPosition;
}

/**
 * What a scope pins for ONE group, as against what that group settles for
 * itself. The same three escapes a lone `<Unit>` has, stated once for every
 * member of the group instead of at each one.
 *
 * Typed by the unit the pin is addressed to, so `as` and `format` check against
 * that unit's kind: `of="m" as="km"` is a length re-expressed and `of="m"
 * as="kg"` is a compile error rather than a request the formatter would drop on
 * the floor.
 */
export interface UnitPins<U extends string = string> {
  /** The rung every member of the group is written at. */
  format?: FormatsFor<U>;
  /** The unit every member of the group is shown in. */
  as?: PresentableAs<U>;
  /** The digit count every member of the group is written at. */
  decimals?: number;
}

const NO_PINS: UnitPins = {};

/** What a scope was ASKED for, as against what it settles. */
interface Policy {
  /**
   * What each NAMED group was pinned to, by its {@link formatGroupKey}. A key
   * missing from this is a group the scope said nothing about, and it settles
   * for itself.
   */
  readonly byKey: ReadonlyMap<string, UnitPins>;
  /**
   * A pin that named no unit, which reaches every group in the scope. See the
   * module header: it is what a pin cannot avoid doing when it has no kind to
   * be addressed to.
   */
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
  /**
   * Every scope of this tree, so a report landing in one of them can re-settle
   * the others. A change at the outermost scope moves the answer a sibling
   * subtree hears, which walking up from the reporter alone would never reach.
   */
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
  /** State what this scope was asked for. Its own props, never an answer. */
  setPolicy(next: Policy): void;
  /** Recompute this scope's answer for `key`. True when it moved. */
  resettle(key: string): boolean;
  /**
   * Join the tree, or leave it once unmounted so a dead scope is not swept for
   * the rest of the tree's life.
   *
   * Both halves rather than a cleanup alone, because React's strict mode runs a
   * layout effect's cleanup and then its body again on the same mount, and a
   * scope that only knew how to leave would never come back.
   */
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

/**
 * The policy a scope's props amount to.
 *
 * Built in the provider's layout effect rather than in render, so the map and
 * the pin objects it holds are never compared by identity: {@link samePolicy}
 * reads their fields, and a caller passing a fresh array literal every render
 * settles nothing extra.
 */
function policyOf(
  of: string | undefined,
  pins: UnitPinsByUnit | undefined,
  own: UnitPins,
  separate: boolean,
): Policy {
  const byKey = new Map<string, UnitPins>();
  if (of !== undefined) byKey.set(formatGroupKey(of), own);
  for (const [unit, pin] of Object.entries(pins ?? {})) {
    /*
     * Two units that share a group get one entry and the later wins, which is
     * the one part of "a group is pinned at most once" the types cannot reach.
     * A distinct KEY is checked (an object literal refuses a repeated one) and
     * a distinct GROUP is not, because a group is a family where a unit
     * declares one and a bare symbol where nothing climbs, and both of those
     * live in registries `registerUnit` can add to at runtime. Checking the
     * kind instead would be unsound the other way: `s` and `min` are one kind
     * and two groups, and refusing that pair would refuse a legitimate scope.
     */
    if (pin !== undefined) byKey.set(formatGroupKey(unit), pin);
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
      // Outermost first. A child's answer is built on its parent's, so a
      // parent settled after its child would leave the child a generation
      // behind for the frame nobody would notice it in.
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
  const root = parent?.root ?? createRoot();
  let policy = NO_POLICY;

  /** The rung of the smallest non-zero member, the one no member loses by. */
  const ownRung = (members: Iterable<Report>): string | undefined => {
    let winner: LadderPosition | undefined;
    for (const member of members) {
      const position = member.position;
      if (position === undefined || position.base === 0) continue;
      if (winner === undefined || position.base < winner.base)
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
      // Up first, so the outermost scope holds every reading in the tree and
      // the rung it settles is the one the whole tree is written at. Only that
      // scope sweeps, once, for the whole family.
      if (parent === undefined) root.sweep(key);
      else parent.hold(key, id, report);
    },

    settled: (key) => settled.get(key),

    setPolicy(next) {
      if (samePolicy(policy, next)) return;
      policy = next;
      /*
       * Every key, even though the PINS are addressed. `separate` is a property
       * of the whole scope, and a pin moving off a key has to let that key go
       * back to settling for itself.
       */
      for (const key of held.keys()) root.sweep(key);
    },

    resettle(key) {
      const members = [...(held.get(key)?.values() ?? [])];
      const inherited = parent?.settled(key);
      // The pin for THIS group, and an unaddressed one only where no group was
      // named at all. A scope that named `m` says nothing about its kilograms.
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
      if (sameFormat(settled.get(key), next)) return false;
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

/**
 * The scope a quantity is in, defaulting to one that holds nothing and never
 * answers.
 *
 * An inert default rather than `undefined` so the hook has no branch: a `<Unit>`
 * with no scope above it reports into this, hears nothing back, and renders off
 * the ladder as it always has.
 */
const NO_SCOPE: Scope = {
  root: { family: new Set(), subscribe: () => () => {}, sweep: () => {} },
  depth: 0,
  hold: () => {},
  settled: () => undefined,
  setPolicy: () => {},
  resettle: () => false,
  attach: () => {},
  detach: () => {},
};

const ScopeContext = createContext<Scope>(NO_SCOPE);

/** What every spelling of the props below shares. */
interface UnitSharedFormatBaseProps {
  children?: ReactNode;
  /**
   * Widen the digit count until the members stop printing the same figure as
   * each other.
   *
   * What an interval wants and what a column does not. A band of 6 700 km to
   * 6 710 km lands on the megametre rung, where a length's default one decimal
   * prints both ends as `6.7 Mm`: an interval rendered as a scalar, silently,
   * exactly where the width was the point. A column of thirty altitudes has no
   * such promise to keep, and widening it until its two closest cells read
   * apart would print six decimals of noise in every row.
   *
   * So the group separates when it is ASKED to, and the asking is the whole of
   * what a caller with an opinion about digits does. A property of the whole
   * scope rather than of one group: a scope told its members must read apart is
   * saying so about all of them.
   */
  separate?: boolean;
}

/**
 * A scope that pins ONE kind, which is every scope with an opinion except a
 * deliberately mixed one.
 *
 * `of` names the unit the pins are addressed to and is the whole of how they
 * come to be typed: `of="m"` makes `as` a length and `format` a rung on the
 * length ladder. It is a value rather than a type argument because the scope
 * needs it at runtime too, to know which of its groups the pin belongs to, and
 * because a caller already holding a `Value<U>` can pass `of={v.unit}` and
 * never annotate anything.
 *
 * Leaving `of` out is still allowed and still means what it always did: the
 * pins are unaddressed, they reach every group, and nothing checks them. See
 * the module header.
 */
export interface UnitSharedFormatProps<U extends string = string>
  extends UnitSharedFormatBaseProps,
    UnitPins<U> {
  /** The unit the pins below are addressed to. */
  of?: U;
}

/**
 * A scope that pins SEVERAL kinds, each in its own unit.
 *
 * Keyed by the unit rather than positional, and the key is what enforces the
 * three rules a mixed scope obeys. Any number of kinds, because the key set is
 * open. A kind that needs nothing is simply absent, because every entry is
 * optional. And a group is pinned at most once, because a repeated key is
 * already an error in an object literal, where a repeated entry in a parallel
 * pair of lists is not: `["m", "m"]` reads as two pins and quietly keeps one.
 *
 * ```tsx
 * <UnitSharedFormat pins={{ m: { as: "km" }, kg: { as: "t" } }}>
 * ```
 *
 * The value is typed by its own key, so `{ m: { as: "kg" } }` is a compile
 * error at the entry that is wrong rather than at the scope.
 *
 * What the key CANNOT catch is two different units of one group: `{ m: ...,
 * km: ... }` is one length group pinned twice and the later wins. See `policyOf`
 * on why checking that soundly needs tables the type system does not have.
 */
export interface UnitSharedFormatMixedProps<U extends string>
  extends UnitSharedFormatBaseProps {
  /** What each named unit's group is pinned to, checked against that unit. */
  pins: { [S in U]?: UnitPins<S> };
}

/** The pin map with its keys erased, as the runtime reads it. */
type UnitPinsByUnit = Readonly<Record<string, UnitPins | undefined>>;

/** Both spellings at once, as the component body actually reads them. */
interface UnitSharedFormatAnyProps extends UnitSharedFormatBaseProps, UnitPins {
  of?: string;
  pins?: UnitPinsByUnit;
}

/**
 * See the module header: the pseudo-component that holds the group.
 *
 * It renders nothing of its own, so it can be dropped around a row, a cell, a
 * whole table or a widget body without touching the layout.
 *
 * `format`, `as` and `decimals` PIN what a group would otherwise settle, for
 * the cases where convention beats magnitude. They are the same escape a lone
 * `<Unit>` has, stated once here rather than at each member, and `of` says
 * which of the scope's groups they are addressed to.
 */
export function UnitSharedFormat<U extends string = string>(
  props: UnitSharedFormatProps<U> | UnitSharedFormatMixedProps<U>,
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
  // The inert default is not a parent. Adopting it would put this scope in a
  // tree whose root never sweeps, so nothing it settled would ever be heard.
  const [scope] = useState(() =>
    createScope(enclosing === NO_SCOPE ? undefined : enclosing),
  );
  useLayoutEffect(() => {
    scope.attach();
    return () => scope.detach();
  }, [scope]);
  // After the members' own effects, which React runs child-first, so the
  // reports are in before the policy that reads them.
  useLayoutEffect(() => {
    scope.setPolicy(policyOf(of, pins, { format, as, decimals }, separate));
  }, [scope, of, pins, format, as, decimals, separate]);
  return (
    <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>
  );
}

/**
 * Report a quantity to the enclosing {@link UnitSharedFormat} and hear back the
 * format its group settled on, or `undefined` when there is no group with an
 * answer for it.
 *
 * `<Unit>` calls this for every value it draws, so a readout needs nothing from
 * this module. It is published for the readouts `<Unit>` cannot draw: an SVG
 * axis renders measured text rather than nodes, and an `aria-valuetext` is an
 * attribute that can only hold a string, so both write their own figure and
 * both must write it at the format the `<Unit>`s beside them are written at.
 *
 * A quantity does NOT report, and gets nothing back, when the caller has
 * already decided its presentation (`format`, `as`, a non-auto `scale`). Those
 * are the cases where a group answer would either be ignored or be wrong, and
 * the hook is inert rather than clever about them. A scope's OWN pins are a
 * different thing and still apply: they are what the group settled.
 */
export function useSharedFormat<U extends string = string>(
  value: Value<U> | null | undefined,
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
  // Where this member sits on the shared ladder, and undefined for a unit that
  // climbs nothing. Two numbers rather than the value itself, so the effect
  // below can depend on the READING instead of on the object carrying it,
  // which is fresh on every render at most call sites.
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
    // The format this hook RETURNS is deliberately absent from these deps. See
    // the module header on why a report that depended on the answer would loop.
  }, [scope, id, key, reading, unit, base, rung]);

  return useSyncExternalStore(
    scope.root.subscribe,
    () => (key === undefined ? undefined : scope.settled(key)),
    () => undefined,
  );
}
