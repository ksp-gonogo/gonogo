import type { ReactNode } from "react";
import { Text } from "./Text";

// styleguide-emdash.test.ts allows the em dash here and nowhere else.
/**
 * The null token, the dash that means "no value to show": nothing has arrived
 * yet, or the game confirmed there is none. It does not say which, so a widget
 * that has to tell them apart reads the reading's `state` and says so in
 * words. Useful for showing the operator an empty figure wherever only a string
 * fits: a formatter's return value, a template fallback, an attribute value.
 * Used by the tape and the band instruments. For a bare JSX node use
 * {@link NullValue}. {@link Unit} already draws it for an absent value.
 *
 * @category Unit
 */
export const NULL_DISPLAY = "—";

/**
 * The null token {@link NULL_DISPLAY} as muted text, so an empty figure reads
 * as having no value rather than as ordinary body text. Useful for showing the
 * operator that a field has nothing to show. Used by the control frame
 * settings. Where a wrapper already carries a placeholder look, interpolate
 * {@link NULL_DISPLAY} into it instead.
 *
 * @category Unit
 */
export function NullValue(): ReactNode {
  return <Text level="muted">{NULL_DISPLAY}</Text>;
}
