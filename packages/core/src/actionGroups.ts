import type { ActionGroupStatePayload } from "@ksp-gonogo/sitrep-client";
import { useMemo } from "react";
import { useTelemetry } from "./hooks/useTelemetry";
import type { ActionGroup } from "./types";

/**
 * The STOCK, non-custom action groups: the fixed singletons KSP has always
 * had, each with its own first-class `vessel.control` field and its own
 * dedicated command (`vessel.control.setGear`, …).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS STILL A LITERAL, AND MUST STAY ONE
 * ---------------------------------------------------------------------------
 * The registry is deliberately HYBRID: static stock singletons (this array) +
 * telemetry-derived customs (`useActionGroups` below). Do NOT "simplify" it
 * into a single fully-derived list, that would be a regression, not a
 * cleanup, because the two halves are different kinds of thing:
 *
 *  - These eight are FIXED stock concepts. No mod extends them: Action Groups
 *    Extended adds CUSTOM groups; it does not add a second SAS. Each already
 *    has a typed field on `vessel.control` and a dedicated command, so
 *    deriving them from a name-matched list would trade a typed read for a
 *    string match and invent a second source of truth for the same fact.
 *  - The CUSTOM groups are the extensible axis, and the only axis a backend
 *    varies: stock reports ten anonymous ones, AGX reports up to 250 the
 *    player names. Those cannot be hardcoded, so they derive from telemetry.
 *
 * Precision Control and Stage are in here too, neither is strictly an action
 * group (one is a flight-input mode, one is a staging command), but both are
 * toggle-shaped and the widget has always offered them.
 * ---------------------------------------------------------------------------
 */
export const STOCK_ACTION_GROUPS = [
  {
    name: "SAS",
    toggle: "f.sas",
    description: "SAS state",
    provenance: "stock",
  },
  {
    name: "RCS",
    toggle: "f.rcs",
    description: "RCS state",
    provenance: "stock",
  },
  {
    name: "Light",
    toggle: "f.light",
    description: "Lights state",
    provenance: "stock",
  },
  {
    name: "Gear",
    toggle: "f.gear",
    description: "Gear state",
    provenance: "stock",
  },
  {
    name: "Brake",
    toggle: "f.brake",
    description: "Brakes state",
    provenance: "stock",
  },
  {
    name: "Abort",
    toggle: "f.abort",
    description: "Abort state",
    provenance: "stock",
  },
  {
    // No toggle key: a read-only indicator. The widget renders its pill
    // disabled rather than as a no-op clickable.
    name: "Precision Control",
    toggle: null,
    description: "Precision mode state",
    provenance: "stock",
  },
  {
    name: "Stage",
    toggle: "f.stage",
    description: "Activate next stage",
    provenance: "stock",
  },
] as const satisfies readonly ActionGroup[];

/**
 * Union of every STOCK action group name. Closed, because stock genuinely is,
 * this is what keeps `ActionGroupId` validating and autocompleting the names we
 * can know at compile time (see `ActionGroupId`).
 */
export type StockActionGroupId = (typeof STOCK_ACTION_GROUPS)[number]["name"];

/**
 * A configured action group's id.
 *
 * `(string & {})` is the standard widening idiom: it admits an arbitrary custom
 * id (an AGX group can be named anything, and is only known at runtime) while
 * KEEPING editor autocomplete and validation for every stock name, TypeScript
 * won't collapse the union to plain `string`. Deliberately NOT bare `string`:
 * that would silently weaken config validation for the eight names we DO know
 * statically.
 */
export type ActionGroupId = StockActionGroupId | (string & {});

/**
 * The id a saved config addresses one group by: its INDEX for a custom group,
 * its name for a stock singleton.
 *
 * A display name cannot serve as an identity on the custom half. Two AGX groups
 * may share one, and nothing stops a player naming theirs after a stock
 * singleton. Because the stock half is listed first, a name-keyed save for a
 * custom group called "Stage" resolves to the stock Stage, whose pill does not
 * toggle anything: it fires `vessel.control.stage` and drops a stage off the
 * vessel. Anything that WRITES `actionGroupId` goes through here.
 */
export function actionGroupIdOf(group: ActionGroup): ActionGroupId {
  return group.index !== undefined ? `AG${group.index}` : group.name;
}

/**
 * The live registry: the stock singletons above, then every CUSTOM group the
 * elected backend reported: NAMED by the backend rather than by us.
 *
 * Under stock this yields the same 18 entries the old hardcoded `ACTION_GROUPS`
 * literal did (AG1..AG10 included), except those ten now arrive as telemetry
 * carrying the mod's own labels. Under a future AGX backend the same code
 * yields the player's 250 named groups with no change here, in the contract, or
 * in the widget, that is the whole point of the capability seam
 * (`mod/Sitrep.Host/ActionGroups/IActionGroupsBackend.cs`).
 *
 * Yields the stock half alone while `vessel.control` hasn't arrived or carries
 * no action-group data, degrading to "SAS/RCS/… work, customs pending" rather
 * than blanking the registry.
 */
export function useActionGroups(): ActionGroup[] {
  const control = useTelemetry("vessel.control");
  // A group's NAME does not decay. "AG1: Solar Panels" is still called that
  // whether the last frame arrived a second ago or an hour ago, so the registry
  // uses the last observed record on every arm that carries one, and a stale
  // link degrades to the stock half only when nothing has EVER arrived.
  //
  // The group's VALUE is the part that goes stale, and it is read separately by
  // whatever renders a toggle: that read branches, this one does not need to.
  // `vessel.control` is declared unmodellable, so there is no `reckonable` arm
  // to consider here.
  const named =
    control.state === "observed" || control.state === "stale"
      ? control.value
      : undefined;
  return useActionGroupsFrom(named);
}

/**
 * `useActionGroups` for a caller that has ALREADY read `vessel.control`, it
 * derives from the payload instead of opening a second subscription to the same
 * topic. `ActionGroup` needs the record anyway (for its own group's value), so
 * without this the widget would subscribe to `vessel.control` twice: once for
 * the value, once inside the registry hook. Same derivation, no duplicate read.
 */
export function useActionGroupsFrom(
  control: { actionGroups?: ActionGroupStatePayload[] | null } | undefined,
): ActionGroup[] {
  const named = control?.actionGroups;
  return useMemo(
    () => [
      ...STOCK_ACTION_GROUPS,
      ...(named ?? []).map((g) =>
        customActionGroup(g.index, g.name, "reported"),
      ),
    ],
    [named],
  );
}

/**
 * Builds a custom group's descriptor from its backend index (+ optional name).
 * The single place the `f.ag{n}` toggle convention is derived, keyed by INDEX,
 * never by name, because `map-command.ts` bridges `f.ag{n}` to
 * `setActionGroup{group: n}` and two AGX groups may share a display name.
 *
 * The index is what makes a group addressable, so an entry that arrived
 * without a usable one gets an inert descriptor rather than a fabricated
 * command: interpolating a missing index yields `f.agundefined`, which is a
 * pill the operator can press and a string no backend can honour. The entry
 * is still listed, because the backend did report a group and dropping it
 * would hide that, it just cannot be fired.
 */
function customActionGroup(
  index: number,
  name: string | undefined,
  provenance: "reported" | "assumed",
): ActionGroup {
  if (!Number.isInteger(index)) {
    return {
      name: name ?? "Unidentified group",
      toggle: null,
      description: "Custom action group with no index",
      provenance,
    };
  }
  return {
    name: name ?? `AG${index}`,
    toggle: `f.ag${index}`,
    description: `Custom action group ${index}`,
    index,
    provenance,
  };
}

/**
 * Resolves ONE configured group id against the live registry.
 *
 * The fallback is the point. Because the custom half is telemetry-derived, a
 * widget configured for `AG1` finds NOTHING in the registry until the first
 * `vessel.control` sample lands: and rendering "No action group configured"
 * for a group the operator plainly did configure is a lie. It's also the state
 * a saved AGX group lands in after AGX is uninstalled.
 *
 * So an unresolved id degrades in the most useful way available:
 *  - `AG{n}` recovers stock's own convention, staying fully operable (the pill
 *    toggles; the value shows ": " until telemetry arrives).
 *  - anything else (an AGX name we can't map back to an index) becomes a
 *    read-only pill under its configured name, visibly present, honestly
 *    unknown, never silently mis-toggling some other group.
 *
 * Either way the descriptor is marked `provenance: "assumed"`, because
 * degrading gracefully and claiming the group exists are different things.
 * Without that mark a widget cannot tell a group the backend reported from
 * one this function invented out of the saved config, so it cannot caveat the
 * pill, and an `AG{n}` fabricated from nothing is otherwise byte-identical to
 * a reported one.
 *
 * Returns `undefined` only when nothing is configured at all, which IS the
 * genuine "No action group configured" case.
 */
export function useActionGroup(
  id: string | undefined,
): ActionGroup | undefined {
  return resolveActionGroup(useActionGroups(), id);
}

/**
 * `useActionGroup` for a caller that has already read `vessel.control`; see
 * {@link useActionGroupsFrom} for why the duplicate subscription is worth
 * avoiding.
 */
export function useActionGroupFrom(
  control: { actionGroups?: ActionGroupStatePayload[] | null } | undefined,
  id: string | undefined,
): ActionGroup | undefined {
  return resolveActionGroup(useActionGroupsFrom(control), id);
}

/** The pure resolution shared by both hooks; see {@link useActionGroup}. */
function resolveActionGroup(
  groups: ActionGroup[],
  id: string | undefined,
): ActionGroup | undefined {
  if (!id) return undefined;
  // `AG{n}` addresses a custom group by INDEX, and the index is the identity,
  // so it is matched against the index rather than the name and is asked FIRST.
  // Both matter: a name lookup would let a player who called some other group
  // "AG5" answer for index 5, and asking it second would let the eight stock
  // singletons shadow any custom group a player named after one of them.
  const match = /^AG(\d+)$/.exec(id);
  if (match) {
    const index = Number(match[1]);
    return (
      groups.find((g) => g.index === index) ??
      customActionGroup(index, undefined, "assumed")
    );
  }
  const found = groups.find((g) => g.name === id);
  if (found) return found;
  return { name: id, toggle: null, description: id, provenance: "assumed" };
}
