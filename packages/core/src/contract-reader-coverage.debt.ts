/**
 * Data for the contract-reader-coverage ratchet
 * (`styleguide-contract-reader-coverage.test.ts`). Pure data module, no test
 * logic, so the shrink-only check can load this file's content at an
 * arbitrary git ref without pulling in vitest. Same split-module shape as
 * `declaration-reachability.allowlist.ts` and `unknown-cast.debt.ts`.
 *
 * SEEDED 2026-09-30, gonogo Saga task 727: the n-body arc (`vessel.orbit.Arc`) and
 * `vessel.trajectory.forVantage`, the ticket's motivating example, are GONE
 * from the contract as of contract 25 (`CONTRACT_MAJOR` in
 * `mod/sitrep-sdk/src/compat-versions.ts`); neither name appears anywhere in
 * `mod/sitrep-sdk/src/__generated__/contract.ts` any more, so they never
 * reach this list. What is seeded instead is what a full scan of the CURRENT
 * contract actually found: 100 fields and 1 command with no production
 * reader anywhere in `packages/` or `mod/*\/client`, and none of them
 * confirmed read by a `gonogo-uplinks` Uplink either (checked by hand against
 * that repo's tree before seeding, no hit).
 *
 * SHAPE OF THE DEBT: 36 of the 100 fields are one of two envelope members
 * (`meta.quality`, `meta.source`) that exist on nearly every payload; a widget
 * reads currency off the `Reading` wrapper (`.state`, `.reckoning`) rather
 * than off this payload-level duplicate, so the whole family is plausibly
 * DEAD rather than merely unwired, and worth a deliberate removal decision
 * rather than 36 individual widget builds. The other 64 are a mix of
 * genuinely-next control surfaces (`vessel.control.translationX/Y/Z/yaw`
 * carry a WRITE-side control-stream vocabulary with a coincidentally
 * identical spelling but no read-side consumer of the corresponding
 * contract field) and smaller per-topic gaps (`flight.*` correlation
 * fields beyond the one each existing bridge already reads,
 * `science.sensors.*`, `system.frame.*` beyond `system.frame.set`'s own
 * unread command, `comms.*` sub-fields beyond what the comms widgets already
 * draw).
 *
 * Regenerate the seed by running `styleguide-contract-reader-coverage.test.ts`
 * (its two coverage assertions print the fresh list) rather than by hand.
 */

/**
 * `field:<topic>.<path>` or `command:<id>` -> one-line reason, SHRINK-ONLY.
 * Never add an entry: a published field or command lands with its reader, or
 * it does not land. Clear one by writing the reader (delete the line) or by
 * confirming an Uplink in `gonogo-uplinks` already reads it (keep the line,
 * with an `Uplink-read: <name>` reason naming which one, checked from the
 * other side by `gonogo-uplinks/tooling/verify-contract-reader-debt.mjs`).
 */
export const CONTRACT_READER_DEBT: Record<string, string> = {
  "field:commcast.transmissions.author.name":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:commcast.transmissions.author.seat":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:commcast.transmissions.author.stationKey":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:commcast.transmissions.from":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:commcast.transmissions.groupId":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:commcast.transmissions.phase":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:commcast.transmissions.startedUt":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:commcast.transmissions.to":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:commcast.transmissions.topic":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:commcast.transmissions.transmissionId":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.commandCentre.bodyIndex":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.commandCentre.id":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.commandCentre.kind":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.commandCentre.meta.quality":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.commandCentre.meta.source":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.connectivity.connected":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.connectivity.controlSource":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.connectivity.hasLocalControl":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.connectivity.meta.quality":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.connectivity.meta.source":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.control.level":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.control.meta.quality":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.control.meta.source":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.control.reason":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.degrade.level":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.degrade.meta.quality":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.degrade.meta.source":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.degrade.modelId":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.degrade.modelName":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.occlusion.bodies":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.occlusion.meta.quality":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.occlusion.meta.source":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.occlusion.modelId":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.occlusion.modelName":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.path.meta.quality":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.path.meta.source":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.signal.meta.quality":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.signal.meta.source":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.signal.strength":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:eva.crew.count":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:eva.crew.kerbals":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:eva.crew.meta.quality":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:eva.crew.meta.source":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:fleet.silence.vessels":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:flight.current.phase":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:flight.current.vesselId":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:flight.ended.reason":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:flight.ended.vesselId":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:flight.vesselChanged.flightId":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:flight.vesselChanged.previousVesselId":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:flight.vesselChanged.ut":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:flight.vesselChanged.vesselId":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:flight.vesselChanged.vesselName":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:game.dlc.makingHistory":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:ksp.revertAvailability.canRevertToEditor":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:ksp.revertAvailability.canRevertToLaunch":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:science.sensors.active":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:science.sensors.partId":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:science.sensors.partName":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:science.sensors.readout":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:science.sensors.type":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:settings.gonogo.meta.quality":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:settings.gonogo.meta.source":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:spaceCenter.partsAvailable.count":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:system.frame.primaryBodies":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:system.frame.primaryBody":
    "no reader found: the read-frame model infers the primary from the secondary's own parent rather than naming it (gonogo Saga task 727 seed, 2026-09-30; task 728 slice 1 cleared centreBody/secondaryBody/targetFrameSelected)",
  "field:system.frame.secondaryBodies":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:system.frame.targetId":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:time.calendar.kerbinTime":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:time.calendar.meta.quality":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:time.calendar.meta.source":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:time.warp.warpRates":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.attitude.meta.quality":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.attitude.meta.source":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.comms.meta.quality":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.comms.meta.source":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.control.translationX":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.control.translationY":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.control.translationZ":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.control.yaw":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.dock.meta.quality":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.dock.meta.source":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.inventory.meta.quality":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.inventory.meta.source":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.inventory.stores":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.maneuver.meta.quality":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.maneuver.meta.source":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.maneuver.planner":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.orbit.truth.meta.quality":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.orbit.truth.meta.source":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.physics.mode.meta.quality":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.physics.mode.meta.source":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.physics.mode.mode":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.thermal.hottestPart.maxTemp":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.thermal.maxSkinTempRatio":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.thermal.meta.quality":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.thermal.meta.source":
    "no reader found; payload-level duplicate of the Reading wrapper state/reckoning (gonogo Saga task 727 seed, 2026-09-30)",
  "command:system.frame.set":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
};
