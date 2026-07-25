/**
 * Hohmann transfer-window phase-angle math.
 *
 * MOVED to `@ksp-gonogo/core` (`calc/transfer.ts`, 2026-07-24) so the SystemView
 * diagram and the standalone Transfer Window widget share one implementation.
 * Re-exported here for back-compat with SystemView's existing importers.
 */
export {
  angleDelta,
  hohmannPhaseAngle,
  type TransferStatus,
  transferStatus,
} from "@ksp-gonogo/core";
