import { ProgressBar } from "./ProgressBar";

/**
 * `ProgressBar` must be named. Checked by `pnpm typecheck`: should the name
 * stop being required, the unused `@ts-expect-error` below fails it.
 */

// @ts-expect-error a progress bar with no accessible name
export const unnamed = <ProgressBar value={42} />;

// @ts-expect-error the pair spelling needs a name too
export const unnamedPair = <ProgressBar quantity={null} />;

export const named = <ProgressBar value={42} ariaLabel="Biome coverage" />;
