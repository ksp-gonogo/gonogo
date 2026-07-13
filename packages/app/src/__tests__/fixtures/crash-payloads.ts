// Real `crash.lastCrash` payloads captured from a live KSP + Telemachus-fork
// session on 2026-06-02 (the diagnostic run that confirmed the source-side
// debris filter). Use these in UI tests instead of hand-written objects so the
// parser stays pinned to the real wire shape — nested `flightStats`, the
// `partsLost` / `events` / crew arrays, `flightEndMode`, and the `vesselType`
// field the rebuilt fork now emits.
//
// Provenance:
//  - SHIP_CRASH_SPLASHDOWN: a real Ship splashdown (eventKind CrashSplashdown).
//  - BURNUP_DESTROYED: a real re-entry burn-up (eventKind Destroyed) — the case
//    that recorded nothing before the onVesselWillDestroy detector.
// Both should fire the banner. There's no debris fixture: the fork filters
// debris at the source, so it never reaches the banner.
//
// These are frozen so a test can't mutate shared state.

export const SHIP_CRASH_SPLASHDOWN = Object.freeze({
  vesselId: "022457fa-6160-432d-a827-b73fc2ab5810",
  eventKind: "CrashSplashdown",
  what: "an unidentified object",
  vesselType: "Ship",
  msg: "",
  latitude: -0.1127,
  longitude: -74.3385,
  partsLost: [
    {
      partId: 960720133,
      partName: "mk1pod.v2",
      partTitle: "Mk1 Command Pod",
      msg: "",
    },
    {
      partId: 960720133,
      partName: "mk1pod.v2",
      partTitle: "Mk1 Command Pod",
      msg: "",
    },
  ],
  body: "Kerbin",
  flightStats: {
    kerbalsKilled: 0,
    partsLost: 1,
    flightEndMode: "CATASTROPHIC_FAILURE",
    highestSpeedOverLand: 290.707,
    missionEnd: true,
    highestGee: 11.9903,
    highestAltitude: 1195.6304,
    totalDistance: 7367.4313,
    missionTime: 21.34,
    highestSpeed: 368.1807,
    groundDistance: 4929.9439,
    liftOff: true,
  },
  vesselName: "career-orbital-test",
  events: [
    "[00:00:00]: Liftoff!!",
    "[00:00:12]: Separation of stage 3 confirmed",
    "[00:00:21]: Mk1 Command Pod splashed down hard and was destroyed.",
  ],
  kerbalsKilled: ["Bill Kerman"],
  situation: "FLYING",
  crewAboard: ["Bill Kerman"],
  altitude: -0.5283,
  ut: 41486.3595,
});

// Real re-entry burn-up, verbatim from a live capture on 2026-06-02. This is the
// `onVesselWillDestroy` detector's reason to exist: a non-collision death that
// fires NO `onCrash`, so the old build recorded nothing. `eventKind: "Destroyed"`,
// `partsLost: []` (every part already cooked off before the vessel-destroy fired),
// and the `events` log shows the thermal cascade ("... exploded due to overheating:
// 2201 / 2200 K"). The banner should fire for this exactly like any other crash.
export const BURNUP_DESTROYED = Object.freeze({
  vesselId: "f7124131-4762-4e1b-9782-b89955159838",
  eventKind: "Destroyed",
  what: "",
  vesselType: "Ship",
  msg: "",
  latitude: 0.1945,
  longitude: -173.4859,
  partsLost: [],
  body: "Kerbin",
  flightStats: {
    kerbalsKilled: 0,
    partsLost: 24,
    flightEndMode: "CATASTROPHIC_FAILURE",
    highestSpeedOverLand: 2334.0122,
    missionEnd: true,
    highestGee: 15.3875,
    highestAltitude: 86748.7887,
    totalDistance: 220358.9913,
    missionTime: 49.54,
    highestSpeed: 2578.5244,
    groundDistance: 184598.8325,
    liftOff: true,
  },
  vesselName: "Perf Test 1",
  events: [
    "[00:00:00]: Liftoff!!",
    "[00:00:35]: Separation of stage 2 confirmed",
    "[00:00:36]: Separation of stage 1 confirmed",
    "[00:00:40]: OX-STAT Photovoltaic Panels exploded due to overheating: 1324 / 1200 K",
    "[00:00:45]: TD-12 Decoupler exploded due to overheating: 2044 / 2000 K",
    "[00:00:46]: KAL9000 Scriptable Control System exploded due to overheating: 1654 / 1500 K",
    "[00:00:49]: Mk1 Command Pod exploded due to overheating: 2201 / 2200 K",
  ],
  kerbalsKilled: ["Lodfred Kerman"],
  situation: "FLYING",
  crewAboard: ["Lodfred Kerman"],
  altitude: 29833.5574,
  ut: 113310.4927,
});
