import {
  type ActionGroup,
  actionGroupIdOf,
  toggleCommandFor,
  useActionGroups,
} from "@ksp-gonogo/core";
import { useMemo } from "react";

/** The `onGo` value for firing nothing at T-0. No action group id spells itself this way. */
export const ON_GO_NONE = "none";

/** The action fired at T-0 until the operator picks another. */
export const DEFAULT_ON_GO = "Stage";

export interface OnGoOption {
  id: string;
  label: string;
}

/**
 * The T-0 choices: Stage first, then every other action group the ActionGroup
 * widget offers that has a command to send, named as that widget names them,
 * then nothing. Precision Control is left out because it is a read-only
 * indicator with nothing to fire.
 */
export function onGoOptionsFrom(groups: readonly ActionGroup[]): OnGoOption[] {
  const firable = groups
    .filter((g) => toggleCommandFor(g) !== null)
    .map((g) => ({ id: actionGroupIdOf(g), label: g.name }));
  const stage = firable.filter((o) => o.id === DEFAULT_ON_GO);
  const rest = firable.filter((o) => o.id !== DEFAULT_ON_GO);
  return [...stage, ...rest, { id: ON_GO_NONE, label: "Nothing" }];
}

/** {@link onGoOptionsFrom} over the live registry. */
export function useOnGoOptions(): OnGoOption[] {
  const groups = useActionGroups();
  return useMemo(() => onGoOptionsFrom(groups), [groups]);
}

/**
 * The name a saved choice is shown under, or `null` for nothing. A choice no
 * longer in the registry (a custom group the vessel has lost) is shown by its
 * saved id.
 */
export function onGoLabelOf(
  options: readonly OnGoOption[],
  onGo: string,
): string | null {
  if (onGo === ON_GO_NONE) return null;
  return options.find((o) => o.id === onGo)?.label ?? onGo;
}
