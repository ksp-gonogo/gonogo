/**
 * A Flight Plan check in a real flight: a stock craft with a four-step plan
 * applied in the VAB's design pane, launched from the editor and climbed by
 * key presses, then
 * placed in a Kerbin orbit and a Mun orbit by GonogoDevTeleport. Captures the
 * game, the app and every held Topic at each step.
 *
 * Copy to scripts/rig/scenarios/ in the run's worktree and run with
 * scripts/rig/scenario.mjs. RIG_CRAFT names a stock craft in the save's
 * Ships/VAB with an antenna (vessel Topics are gated without a link).
 *
 * No command opens the VAB, so the run puts the craft on the pad, reverts to
 * the VAB from the pause menu, applies the plan there, and launches from the
 * editor. RIG_REVERT and RIG_LAUNCH are the xin.py steps for those two clicks
 * in the game's 1280x800 pixels (for example "click 640 420"), read from a
 * game frame first.
 */
const CRAFT = process.env.RIG_CRAFT ?? "Kerbal X";
const REVERT = process.env.RIG_REVERT;
const LAUNCH = process.env.RIG_LAUNCH;
if (!REVERT || !LAUNCH) {
  throw new Error("set RIG_REVERT and RIG_LAUNCH to the xin.py click steps");
}
const firstVesselId = process.env.RIG_FIRST_VESSEL;
const PLUGIN_DATA =
  '"$HOME/.local/share/Steam/steamapps/common/Kerbal Space Program/GameData/GonogoDevTools/Plugins/PluginData"';

const PLAN = {
  id: "rig-plan-mun",
  name: "Rig check, Mun",
  reserve: 0.1,
  steps: [
    {
      id: "s1",
      kind: "launch",
      inputs: { heading: 90, clearAltitude: 10_000 },
      intents: [],
    },
    {
      id: "s2",
      kind: "reach-orbit",
      inputs: { body: "Kerbin", periapsis: 80_000 },
      needsDv: 3_400,
      intents: [
        {
          group: 2,
          label: "AG2",
          trigger: {
            kind: "value",
            quantity: "altitude",
            op: ">=",
            value: 30_000,
          },
        },
      ],
    },
    {
      id: "s3",
      kind: "transfer",
      inputs: { to: "Mun", arrivalPeriapsis: 15_000 },
      needsDv: 860,
      intents: [],
    },
    {
      id: "s4",
      kind: "land",
      inputs: { on: "Mun" },
      needsDv: 890,
      intents: [],
    },
  ],
};

const panel = (i, componentId, x, y, w, h, config) => ({
  item: { i, componentId, ...(config ? { config } : {}) },
  layout: { i, x, y, w, h },
});

const flight = [
  panel("plan", "flight-plan", 0, 0, 12, 22),
  panel("orbit", "orbit-view", 12, 0, 9, 14),
  panel("fuel", "fuel-status", 21, 0, 9, 22),
  panel("navball", "navball", 12, 14, 9, 8),
];

const altitude = (p) => p.altitudeAsl;

/** Frame intervals and long tasks in the app page over `seconds`, as JSON on the run log. */
const frameCost = (label, seconds) => ({
  name: `frame-cost-${label}`,
  app: async (page) => {
    const stats = await page.evaluate(async (ms) => {
      const gaps = [];
      const long = [];
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) long.push(e.duration);
      });
      obs.observe({ type: "longtask", buffered: false });
      let last = performance.now();
      const end = last + ms;
      await new Promise((done) => {
        const tick = (now) => {
          gaps.push(now - last);
          last = now;
          if (now < end) requestAnimationFrame(tick);
          else done();
        };
        requestAnimationFrame(tick);
      });
      obs.disconnect();
      gaps.sort((a, b) => a - b);
      const q = (f) =>
        gaps[Math.min(gaps.length - 1, Math.floor(f * gaps.length))];
      return {
        frames: gaps.length,
        p50: q(0.5),
        p95: q(0.95),
        max: gaps[gaps.length - 1],
        longTasks: long.length,
        longTaskMs: long.reduce((a, b) => a + b, 0),
      };
    }, seconds * 1000);
    console.log(JSON.stringify({ frameCost: label, ...stats }));
  },
});

const teleport = (id, body, periapsisKm, apoapsisKm) => ({
  name: `teleport-${id}`,
  deck: `printf 'TELEPORT\\n{\\n  id = ${id}-%s\\n  body = ${body}\\n  periapsisKm = ${periapsisKm}\\n  apoapsisKm = ${apoapsisKm}\\n  inclinationDeg = 0\\n}\\n' "$(date +%s)" > ${PLUGIN_DATA}/teleport-request.cfg`,
});

const WIDGET = process.env.RIG_WIDGET !== "0";
const perf = (id, on) => ({
  name: `perf-${id}-${on}`,
  deck: `printf 'PERFPROBE\\n{\\n  id = ${id}-%s\\n  enable = ${on}\\n}\\n' "$(date +%s)" > ${PLUGIN_DATA}/perf-request.cfg`,
});
const items = WIDGET ? flight : flight.filter((p) => p.item.i !== "plan");

const setup = {
  name: "setup-app",
  app: async (page) => {
    await page.waitForTimeout(3_000);
    const skips = page.getByRole("button", { name: "Skip", exact: true });
    const total = await skips.count();
    for (let i = 0; i < total; i++) {
      await skips.nth(i).click();
      await page.waitForTimeout(300);
    }
    const carryOn = page.getByRole("button", { name: "Continue" });
    if (await carryOn.count()) await carryOn.click();
    await page.waitForTimeout(2_000);
    if (!WIDGET) return;
    await page.evaluate((plan) => {
      localStorage.setItem("gonogo.flightPlans", JSON.stringify([plan]));
    }, PLAN);
    await page.reload();
    await page.waitForTimeout(6_000);
    await page.getByRole("button", { name: "Apply plan" }).first().click();
    await page.getByText("Rig check, Mun").first().click();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await page.waitForTimeout(2_000);
  },
};

export default {
  name: WIDGET ? "flight-plan-tail" : "flight-plan-tail-nowidget",
  topics: [
    "spaceCenter.scene",
    "vessel.identity",
    "vessel.flight",
    "vessel.control",
    "vessel.orbit",
    "vessel.propulsion",
    "dv.summary",
    "dv.stages",
    "comms.link",
    "time.warp",
  ],
  dashboards: {
    Flight: {
      items: items.map((p) => p.item),
      layout: items.map((p) => p.layout),
    },
  },
  steps: process.env.RIG_MUN
    ? [
        { sleep: 5 },
        setup,
        { capture: "13-kerbin-before-mun" },
        teleport("mun2", "Mun", 30, 40),
        { sleep: 90 },
        { capture: "14-mun-90s" },
        { sleep: 120 },
        { capture: "15-mun-210s" },
      ]
    : [
        { sleep: 10 },
        setup,
        ...(WIDGET
          ? [
              { capture: "11-mun-link-back" },
              teleport("kerbin2", "Kerbin", 82, 90),
              { sleep: 25 },
              { capture: "12-kerbin-orbit-again" },
            ]
          : [{ sleep: 5 }]),
        perf(WIDGET ? "perf-widget" : "perf-nowidget", "true"),
        { sleep: 5 },
        frameCost(WIDGET ? "orbit-widget" : "orbit-nowidget", 30),
        perf(WIDGET ? "perf-widget" : "perf-nowidget", "false"),
      ],
};
