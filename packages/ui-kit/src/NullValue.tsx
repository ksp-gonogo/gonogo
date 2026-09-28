import type { ReactNode } from "react";
import { Text } from "./Text";

/**
 * The one sanctioned em dash in the codebase: the UI convention for "no data
 * yet". Every other call site routes through one of the two exports here, and
 * `styleguide-emdash.test.ts` fails the build on any other occurrence.
 *
 *  - `NULL_DISPLAY`, a plain string, for anywhere a string is the only option:
 *    a formatter's return value, a template fallback, an attribute value
 *  - `NullValue`, a component, for a bare JSX node with no wrapper already
 *    carrying a placeholder look; where one exists, interpolate `NULL_DISPLAY`
 *    into it instead
 */
export const NULL_DISPLAY = "—";

/**
 * Renders `NULL_DISPLAY` through `Text tone="muted"`, so a bare placeholder
 * reads as intentionally empty rather than as ordinary body text.
 */
export function NullValue(): ReactNode {
  return <Text level="muted">{NULL_DISPLAY}</Text>;
}
