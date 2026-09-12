import type { Value } from "@ksp-gonogo/sitrep-sdk";
import {
  createContext,
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
  type LadderPosition,
  ladderPosition,
  unitScaleKey,
} from "./units";

/**
 * A group of quantities that settles ONE rung per kind, so the whole group
 * reads as one instrument.
 *
 * ```tsx
 * <UnitScale>
 *   <Unit value={low} /> – <Unit value={high} />
 * </UnitScale>
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
 * over where its reading sits on the shared ladder and which rung it would have
 * picked alone, and is given back the rung the group settled on; outside a scope
 * the hook is inert and the ladder answers per value, exactly as it did before
 * this existed. So a caller wraps and is finished: it names no reference value,
 * no rung and no unit, and it cannot forget to at one of the sites.
 *
 * A report carries no value and no formatted text, which is what keeps the
 * ladder in one place: `ladderPosition` in `units.ts` runs it, and this file
 * compares two numbers and picks a winner.
 *
 * That is the difference from {@link quantityScale}, which is still the right
 * tool where it applies. A moving-scale instrument HAS a reference: the top of
 * the strip is the axis, and every mark on it is below that by construction. A
 * band has two ends and no axis, and a table column has N cells and no axis, so
 * there is nothing for a caller to nominate.
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
 * ## One rung per KIND
 *
 * Grouping is per kind, so a mixed scope works: metres settle on metres and
 * kilograms on kilograms, in the same group, with no caller separating them.
 * The key is a FAMILY where a unit declares one, because bits and bytes share
 * the data dimension and must not share rungs.
 *
 * ## Two passes, and why it cannot loop
 *
 * A member cannot know the group rung on the first pass, because the group is
 * not assembled until its members have rendered. So the first pass draws each
 * member at its own rung, the reports land in layout effects, and a changed
 * group rung re-renders the scope. Layout effects run before the browser
 * paints, so the corrected rung is in the first frame a reader sees and there
 * is no flicker.
 *
 * It settles in exactly one extra pass, and the reason is structural rather
 * than a matter of luck: **what a member reports is a function of its own props
 * alone.** The rung pushed back is never an input to a report, so the second
 * pass reproduces the first pass's reports exactly, the settled rung comes out
 * the same, and nothing further is scheduled. Two things keep that true and are
 * worth knowing before editing:
 *
 * - a member's report effect does NOT depend on the rung it was given back.
 *   Its deps are the store and its own reading, and the store's identity never
 *   changes, which is why the rung reaches members through
 *   `useSyncExternalStore` rather than through the context value. A context
 *   value that changed identity per settle would re-run every member's effect,
 *   whose cleanup drops its entry and whose body puts it back, and a drop that
 *   moves the group rung schedules another settle. That is an infinite loop,
 *   and it is the one this shape exists to make unwritable
 * - the store notifies only when a settled rung actually CHANGES, not on every
 *   report. A scope of thirty cells re-renders when the group's answer moves
 *   and stays still through every frame that does not move it
 *
 * Hysteresis is deliberately not wired in here. `formatQuantity` can hold a
 * rung across a boundary and doing that for a group would make the output an
 * input, which is exactly the property above. It is also not needed yet: a lone
 * `<Unit>` has no memory either, so a group that held one would behave unlike
 * every readout beside it.
 */

interface Scope {
  /** Put or drop one member's report under `key`. `undefined` drops it. */
  hold(key: string, id: string, report: LadderPosition | undefined): void;
  /** The rung `key` has settled on, or undefined while it holds nothing. */
  rung(key: string): string | undefined;
  subscribe(listener: () => void): () => void;
}

function createScope(): Scope {
  const held = new Map<string, Map<string, LadderPosition>>();
  const settled = new Map<string, string>();
  const listeners = new Set<() => void>();

  /** The rung of the smallest non-zero member, which is the one no member loses by. */
  const settle = (key: string): string | undefined => {
    let winner: LadderPosition | undefined;
    for (const report of held.get(key)?.values() ?? []) {
      if (report.base === 0) continue;
      if (winner === undefined || report.base < winner.base) winner = report;
    }
    return winner?.rung;
  };

  return {
    hold(key, id, report) {
      const forKey = held.get(key);
      if (report === undefined) {
        if (forKey === undefined) return;
        forKey.delete(id);
        if (forKey.size === 0) held.delete(key);
      } else {
        const prior = forKey?.get(id);
        if (
          prior !== undefined &&
          prior.base === report.base &&
          prior.rung === report.rung
        ) {
          return;
        }
        if (forKey === undefined) held.set(key, new Map([[id, report]]));
        else forKey.set(id, report);
      }
      const next = settle(key);
      if (next === settled.get(key)) return;
      if (next === undefined) settled.delete(key);
      else settled.set(key, next);
      for (const listener of listeners) listener();
    },
    rung: (key) => settled.get(key),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
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
  hold: () => {},
  rung: () => undefined,
  subscribe: () => () => {},
};

const ScopeContext = createContext<Scope>(NO_SCOPE);

export interface UnitScaleProps {
  children?: ReactNode;
}

/**
 * See the module header: the pseudo-component that holds the group.
 *
 * It renders nothing of its own, so it can be dropped around a row, a cell, a
 * whole table or a widget body without touching the layout.
 *
 * **A nested scope JOINS the enclosing one rather than dividing it.** A `<Band>`
 * carries its own scope, and a column of bands wants its rung settled down the
 * column rather than per row, so the outermost scope wins. Splitting a group
 * deliberately means not nesting: two scopes side by side are two groups.
 */
export function UnitScale({ children }: UnitScaleProps) {
  const enclosing = useContext(ScopeContext);
  const [own] = useState(createScope);
  return enclosing === NO_SCOPE ? (
    <ScopeContext.Provider value={own}>{children}</ScopeContext.Provider>
  ) : (
    <>{children}</>
  );
}

/**
 * Report a quantity to the enclosing {@link UnitScale} and hear back the rung
 * its group settled on, or `undefined` when there is no group with an answer
 * for it.
 *
 * `<Unit>` calls this for every value it draws, so a readout needs nothing from
 * this module. It is published for the readouts `<Unit>` cannot draw: an SVG
 * axis or a gauge face renders measured text rather than nodes, and passing the
 * rung this hands back to `quantityScale` as `format` aligns one with the
 * `<Unit>` readouts beside it.
 *
 * A quantity does NOT report, and gets nothing back, when the caller has
 * already decided the rung (`format`), when the presentation is not a ladder
 * (`scale`, `as`), or when its unit does not climb at all. Those are the cases
 * where a group answer would either be ignored or be wrong, and the hook is
 * inert rather than clever about them.
 */
export function useSharedRung<U extends string = string>(
  value: Value<U> | null | undefined,
  opts: FormatQuantityOptions = {},
): string | undefined {
  const scope = useContext(ScopeContext);
  const id = useId();
  const magnitude = magnitudeOf(value);
  const unit: string | undefined = value?.unit;
  const decided =
    opts.format !== undefined ||
    opts.as !== undefined ||
    (opts.scale !== undefined && opts.scale !== "auto");
  const key = decided || magnitude === null ? undefined : unitScaleKey(unit);
  // What this member votes with, and the whole of it: where it sits on the
  // shared ladder and the rung it would pick alone. Two numbers rather than the
  // value itself, so the effect below can depend on the READING instead of on
  // the object carrying it, which is fresh on every render at most call sites.
  const position =
    key === undefined || magnitude === null
      ? undefined
      : ladderPosition(magnitude, unit);
  const base = position?.base;
  const rung = position?.rung;

  useLayoutEffect(() => {
    if (key === undefined || base === undefined || rung === undefined) return;
    scope.hold(key, id, { base, rung });
    return () => scope.hold(key, id, undefined);
    // The rung this hook RETURNS is deliberately absent from these deps. See
    // the module header on why a report that depended on the answer would loop.
  }, [scope, id, key, base, rung]);

  return useSyncExternalStore(
    scope.subscribe,
    () => (key === undefined ? undefined : scope.rung(key)),
    () => undefined,
  );
}
