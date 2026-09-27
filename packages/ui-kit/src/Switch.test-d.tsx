import { Switch } from "./Switch";

/**
 * A `Switch` must be named exactly once. Checked by `pnpm typecheck`: should
 * either rule loosen, the unused `@ts-expect-error` below fails it.
 */

// @ts-expect-error a switch with no accessible name
export const unnamed = <Switch checked={false} onChange={() => {}} />;

export const namedTwice = (
  // @ts-expect-error a visible label and an aria-label at once
  <Switch checked={false} onChange={() => {}} label="A" aria-label="A" />
);

export const labelled = (
  <Switch checked={false} onChange={() => {}} label="Auto-stage" />
);

export const ariaNamed = (
  <Switch checked={false} onChange={() => {}} aria-label="Auto-stage" />
);
