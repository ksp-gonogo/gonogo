/**
 * A glyph commit has to carry a name, and `tsc` is what enforces it.
 *
 * Compiled by `tsconfig.test-d.json`, `@ts-expect-error` blocks included, so a
 * pairing that stopped biting fails the build rather than quietly becoming
 * documentation.
 *
 * The failure being pinned is invisible in every other instrument: every icon
 * in this kit is `aria-hidden`, so an icon-only commit with no `commitAriaLabel`
 * renders exactly as intended, passes a click test, and reaches a screen reader
 * as "button".
 */

import { SendIcon } from "../Icons";
import { CommandGroup } from "./CommandGroup";

const value = { pan: 0 };
const noop = () => {};

// ── A word names itself ─────────────────────────────────────────────────────
<CommandGroup value={value} onChange={noop} onCommit={noop} commitLabel="Send">
  <input />
</CommandGroup>;

// So does the default.
<CommandGroup value={value} onChange={noop} onCommit={noop}>
  <input />
</CommandGroup>;

// ── A glyph does not ────────────────────────────────────────────────────────
// @ts-expect-error a non-text commitLabel must be paired with commitAriaLabel
<CommandGroup
  value={value}
  onChange={noop}
  onCommit={noop}
  commitLabel={<SendIcon size={16} />}
>
  <input />
</CommandGroup>;

// Which is what the pairing looks like.
<CommandGroup
  value={value}
  onChange={noop}
  onCommit={noop}
  commitLabel={<SendIcon size={16} />}
  commitAriaLabel="Commit framing"
>
  <input />
</CommandGroup>;
