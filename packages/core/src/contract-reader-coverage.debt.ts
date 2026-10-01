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
 * SHAPE OF THE DEBT: 8 entries are `meta.source` on a Topic a SCET
 * threshold alarm can address, read by the MOD rather than by any client
 * (`ScetPayload.ReadSource` checks it against the alarm's subject), which
 * this scan cannot see because it walks TypeScript only. The rest are
 * genuinely-next control surfaces (`vessel.control.translationX/Y/Z/yaw`
 * carry a WRITE-side control-stream vocabulary with a coincidentally
 * identical spelling but no read-side consumer of the corresponding
 * contract field) and smaller per-topic gaps (`flight.*` correlation
 * fields beyond the one each existing bridge already reads,
 * `science.sensors.*`, `system.frame.*`, `comms.*` sub-fields beyond what
 * the comms widgets already draw).
 *
 * RE-SEEDED, gonogo Saga task 761: the scan now sees C# readers under `mod/`
 * (the 8 `meta.source` entries that `ScetPayload.ReadSource` reads came off)
 * and no longer credits a widget that declares no `fields` as reading every
 * field of its Topics, which surfaced fields that were only ever mounted on.
 * Those arrive under a "newly visible unread (Saga 761" reason. The scan then
 * credited a field read off an element or a destructured binding, and 47 of
 * the 125 came off; the one-time admission the check made for them is gone,
 * so the list is strictly shrink-only again.
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
  "field:comms.connectivity.connected":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.connectivity.controlSource":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.connectivity.hasLocalControl":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.control.level":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.control.reason":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.degrade.level":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.degrade.modelId":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.degrade.modelName":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.occlusion.bodies":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.occlusion.modelId":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.occlusion.modelName":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:comms.signal.strength":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:eva.crew.count":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:eva.crew.kerbals":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
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
  "field:spaceCenter.partsAvailable.count":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:system.frame.primaryBodies":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:system.frame.secondaryBodies":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:system.frame.targetId":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:time.calendar.kerbinTime":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:time.warp.warpRates":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.control.translationX":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.control.translationY":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.control.translationZ":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.control.yaw":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.inventory.stores":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.maneuver.planner":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.physics.mode.mode":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:vessel.thermal.maxSkinTempRatio":
    "no reader found (gonogo Saga task 727 seed, 2026-09-30)",
  "field:career.status.strategies.activeCount":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:career.status.tech.unlockedCount":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:career.status.tech.unlockedIds":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:commandCentre.roster.bodyIndex":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:commandCentre.roster.delayQuality":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:commandCentre.roster.latitude":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:commandCentre.roster.longitude":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:comms.delay.meta.source":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:comms.delay.source":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:comms.link.meta.source":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:crash.lastCrash.altitude":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:crash.lastCrash.eventKind":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:crash.lastCrash.events":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:crash.lastCrash.flightStats.highestSpeedOverLand":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:crash.lastCrash.flightStats.liftOff":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:crash.lastCrash.flightStats.missionEnd":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:crash.lastCrash.flightStats.totalDistance":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:crash.lastCrash.latitude":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:crash.lastCrash.longitude":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:crash.lastCrash.msg":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:crash.lastCrash.vesselId":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:crash.lastCrash.vesselType":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:deployed.bases.biome":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:deployed.bases.body":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:deployed.bases.deployedOnGround":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:deployed.bases.experimentId":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:deployed.bases.partName":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:deployed.bases.situation":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:deployed.bases.vesselName":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:dv.stages.dvActual":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:dv.stages.dvAsl":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:dv.stages.dvVac":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:dv.stages.thrustAsl":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:dv.stages.twrActual":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:dv.stages.twrAsl":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:dv.stages.twrVac":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:isru.drills.deployed":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:parts.power.alternators":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:parts.power.batteries":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:parts.power.fuelCells":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:parts.power.solarPanels":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:robotics.servos.motorState":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:robotics.servos.partName":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:robotics.servos.servoIsMotorized":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:robotics.servos.traverseVelocity":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:science.instruments.experimentId":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:science.instruments.partName":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:science.instruments.resettable":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:science.lab.partName":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:science.lab.valueModel":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:settings.gonogo.persistence.savedAtUt":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:spaceCenter.crewRoster.available":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:spaceCenter.crewRoster.experience":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:spaceCenter.crewRoster.situation":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:spaceCenter.launchSites.bodyIndex":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:spaceCenter.launchSites.displayName":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:spaceCenter.launchSites.isStock":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:spaceCenter.launchSites.latitude":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:spaceCenter.launchSites.longitude":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:spaceCenter.savedShips.partCount":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:spaceCenter.savedShips.totalMass":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:vessel.landing.outcome":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:vessel.landing.predictedSlopeHeading":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:vessel.landing.predictedTerrainElevation":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:vessel.landing.slopeAngleUnderVessel":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:vessel.landing.slopeSampleRadiusMeters":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:vessel.landing.terrainElevationUnderVessel":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:vessel.orbit.horizon.kind":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:vessel.orbit.horizon.untilUt":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:vessel.structure.partCount":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:vessel.target.orbit.horizon.kind":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:vessel.target.orbit.horizon.trajectoryKind":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:vessel.target.orbit.horizon.untilUt":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:vessel.target.orbit.meta.quality":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:vessel.target.orbit.meta.source":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:vessel.target.orbit.patches":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
  "field:vessel.target.partId":
    "newly visible unread (Saga 761: a widget with no `fields` no longer counts as a reader)",
};
