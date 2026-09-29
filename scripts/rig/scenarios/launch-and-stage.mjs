/**
 * Launch a craft from the pad, stage it and climb, capturing the game and the
 * flight widgets side by side at each step so altitude, speed, stage, delta-v
 * and orbit can be read against the game's own readouts.
 *
 * Needs a throwaway SANDBOX save loaded at the Space Center whose
 * `Ships/VAB/` holds the craft, and a craft whose parts all resolve on the
 * installed mod set. RIG_CRAFT names it; the default is RP-1's own sample
 * sounding rocket, which needs ROEngines and ROTanks.
 */
const CRAFT = process.env.RIG_CRAFT ?? "WAC-Corporal";

const panel = (i, componentId, x, y, w, h, config) => ({
  item: { i, componentId, ...(config ? { config } : {}) },
  layout: { i, x, y, w, h },
});

const flight = [
  panel("navball", "navball", 0, 0, 9, 14),
  panel("ascent", "circular-orbit", 9, 0, 9, 14),
  panel("orbit", "current-orbit", 18, 0, 9, 14),
  panel("fuel", "fuel-status", 27, 0, 9, 22),
  panel("twr", "twr", 0, 14, 9, 8),
  panel("warp", "warp-control", 9, 14, 9, 8),
  panel("sas", "action-group", 18, 14, 4, 4, { actionGroupId: "SAS" }),
];

const altitude = (p) => p.altitudeAsl;

export default {
  name: "launch-and-stage",
  topics: [
    "vessel.flight",
    "vessel.orbit",
    "vessel.identity",
    "vessel.structure",
    "vessel.propulsion",
    "dv.summary",
    "dv.stages",
    "time.warp",
  ],
  dashboards: {
    Flight: {
      items: flight.map((p) => p.item),
      layouts: { lg: flight.map((p) => p.layout) },
    },
  },
  steps: [
    { capture: "01-space-center" },
    {
      name: "launch",
      command: "ksp.launch",
      args: { shipName: CRAFT, facility: "VAB", site: "LaunchPad", crew: [] },
      timeoutS: 120,
      giveUpS: 180,
      expect: "response",
    },
    {
      name: "on-pad",
      wait: "vessel.identity",
      until: (p) => p.situation !== undefined,
      timeoutS: 240,
    },
    { sleep: 10 },
    { capture: "02-on-pad" },
    { name: "full-throttle", input: "key z; sleep 1" },
    { name: "stage-1", input: "key space; sleep 2" },
    {
      name: "climb-500",
      wait: "vessel.flight",
      until: (p) => altitude(p) > 500,
      timeoutS: 90,
    },
    { capture: "03-climb-500m" },
    {
      name: "climb-5k",
      wait: "vessel.flight",
      until: (p) => altitude(p) > 5_000,
      timeoutS: 180,
    },
    { capture: "04-climb-5km" },
    { name: "stage-2", input: "key space; sleep 2", optional: true },
    { capture: "05-after-stage-2" },
    {
      name: "climb-30k",
      wait: "vessel.flight",
      until: (p) => altitude(p) > 30_000,
      timeoutS: 300,
      optional: true,
    },
    { capture: "06-climb-30km" },
    {
      name: "apoapsis",
      wait: "vessel.flight",
      until: (p) => p.verticalSpeed < 0,
      timeoutS: 600,
      optional: true,
    },
    { capture: "07-apoapsis" },
  ],
};
