import type { ReactNode } from "react";
import { Text } from "./Text";

// styleguide-emdash.test.ts allows the em dash here and nowhere else.
/**
 * The null token, the dash that means "no data yet". Use it anywhere only a
 * string fits: a formatter's return value, a template fallback, an attribute
 * value. For a bare JSX node use {@link NullValue}. {@link Unit} already draws
 * it for an absent value.
 *
 * @category Unit
 */
export const NULL_DISPLAY = "—";

/**
 * Renders {@link NULL_DISPLAY} as muted text, so a bare placeholder reads as
 * intentionally empty rather than as ordinary body text. Where a wrapper
 * already carries a placeholder look, interpolate {@link NULL_DISPLAY} into it
 * instead.
 *
 * @category Unit
 */
export function NullValue(): ReactNode {
  return <Text level="muted">{NULL_DISPLAY}</Text>;
}
