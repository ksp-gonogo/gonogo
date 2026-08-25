import type {
  Logger as AppLogger,
  TaggedLogger as AppTaggedLogger,
} from "@ksp-gonogo/logger";
import type { Logger, TaggedLogger } from "./logger-contract";

/**
 * The SDK declares its own `Logger` rather than re-exporting the app's, because
 * `@ksp-gonogo/logger` is unpublished and a consumer cannot resolve it. That
 * buys a second definition, and two definitions of the same thing drift.
 *
 * This is the thing that stops them. It runs only under `pnpm typecheck`, which
 * is the sole pass that compiles `*.test-d.ts` (vitest goes through esbuild and
 * never typechecks), and that pass is a step of the blocking `test` job.
 *
 * The assignment direction is the one that matters: the app's real logger must
 * satisfy the SDK's contract, because `getHost().logger` is what the SDK's
 * `logger` proxy forwards to at runtime. The reverse does not need to hold, and
 * asserting it would forbid the app's logger from ever growing a method.
 */

declare const appLogger: AppLogger;
declare const appTagged: AppTaggedLogger;

export const satisfiesContract: Logger = appLogger;
export const taggedSatisfiesContract: TaggedLogger = appTagged;

/**
 * And the runtime direction: what the SDK hands an author has to be usable as
 * the app's logger wherever the app passes one in. `ConsoleLogger` and the host
 * injection both rely on this holding structurally.
 */
declare const sdkLogger: Logger;
export const contractIsUsableAsAppLogger: AppLogger = sdkLogger;
