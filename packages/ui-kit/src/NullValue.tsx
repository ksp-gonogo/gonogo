import type { ReactNode } from "react";
import { Text } from "./Text";

/**
 * The ONE sanctioned em dash in the codebase: the UI convention for "no
 * data yet" (undefined/null/non-finite telemetry, an unresolved lookup, a
 * reading that hasn't arrived). Every other call site routes through one
 * of the two exports below instead of writing the character again; a
 * stray em dash anywhere else in the repo is a mistake, not a second
 * convention, and the ratchet in
 * `packages/core/src/styleguide-emdash.test.ts` fails the build on any
 * other occurrence, allowing exactly this one definition.
 *
 * Two shapes, because call sites split cleanly into two kinds:
 *
 *  - `NULL_DISPLAY`, a plain string, for anywhere a string is the only
 *    option: a formatter's return value, a `??`/ternary fallback baked
 *    into a template literal, a `title`/`aria-label` attribute value.
 *    This covers most call sites in this codebase (`formatNumber`,
 *    `formatDuration`, `formatKspDate`, and every widget readout that
 *    formats its own value).
 *  - `NullValue`, a component, for a bare JSX node with no styled
 *    wrapper of its own already carrying a placeholder look. Most call
 *    sites already have one (a `Chip`, a bespoke `Dash`/`Muted` span,
 *    or `Text tone="muted"` directly): prefer interpolating
 *    `NULL_DISPLAY` into that existing wrapper over nesting a second
 *    element inside it. Reach for `NullValue` only when there truly is
 *    no such wrapper.
 */
export const NULL_DISPLAY = "—";

/**
 * Renders `NULL_DISPLAY` through `Text tone="muted"`, so a bare
 * placeholder reads as intentionally-empty rather than as ordinary body
 * text. See the module doc comment above for when to reach for this
 * versus `NULL_DISPLAY` directly.
 */
export function NullValue(): ReactNode {
  return <Text tone="muted">{NULL_DISPLAY}</Text>;
}
