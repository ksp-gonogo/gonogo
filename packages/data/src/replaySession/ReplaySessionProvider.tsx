/**
 * The mission-replay provider moved to `@ksp-gonogo/sitrep-sdk`, with the session
 * controller it reads. See `./ReplaySessionController.ts` for why.
 *
 * Re-exported so this package's importers keep their import site.
 */
export {
  ReplaySessionProvider,
  useReplaySessionActive,
} from "@ksp-gonogo/sitrep-sdk/spine";
