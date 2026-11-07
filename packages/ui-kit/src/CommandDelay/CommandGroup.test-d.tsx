/**
 * A glyph commit has to carry a name, enforced by `tsc` via
 * `tsconfig.test-d.json`. Every kit icon is `aria-hidden`, so an unnamed
 * icon-only commit renders and clicks fine and reaches a screen reader as
 * "button".
 */

import { SendIcon } from "../Icons";
import { CommandGroup } from "./CommandGroup";

const value = { pan: 0 };
const noop = () => {};

// A word names itself.
<CommandGroup value={value} onCommit={noop} commitLabel="Send">
  <input />
</CommandGroup>;

// So does the default.
<CommandGroup value={value} onCommit={noop}>
  <input />
</CommandGroup>;

// A glyph does not.
// @ts-expect-error a non-text commitLabel must be paired with commitAriaLabel
<CommandGroup
  value={value}
  onCommit={noop}
  commitLabel={<SendIcon size={16} />}
>
  <input />
</CommandGroup>;

// Which is what the pairing looks like.
<CommandGroup
  value={value}
  onCommit={noop}
  commitLabel={<SendIcon size={16} />}
  commitAriaLabel="Commit framing"
>
  <input />
</CommandGroup>;
