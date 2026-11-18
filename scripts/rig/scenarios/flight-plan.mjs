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
let firstVesselId = process.env.RIG_FIRST_VESSEL;
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

export default {
  name: "flight-plan",
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
      items: flight.map((p) => p.item),
      layout: flight.map((p) => p.layout),
    },
  },
  steps: [
    { sleep: 15 },
    {
      name: "to-pad",
      command: "ksp.launch",
      args: {
        shipName: CRAFT,
        facility: "VAB",
        site: "LaunchPad",
        crew: ["Jebediah Kerman"],
      },
      timeoutS: 120,
      giveUpS: 180,
      expect: "response",
    },
    {
      name: "first-on-pad",
      wait: "vessel.identity",
      until: (p) => {
        firstVesselId = p.vesselId;
        return p.situation !== undefined;
      },
      timeoutS: 240,
    },
    { sleep: 10 },
    { name: "revert-to-vab", input: `key Escape; sleep 2; ${REVERT}; sleep 2` },
    {
      name: "in-editor",
      wait: "spaceCenter.scene",
      until: (p) => p.scene === "Editor",
      timeoutS: 120,
    },
    { sleep: 5 },
    {
      name: "seed-plan",
      app: async (page) => {
        await page.evaluate((plan) => {
          localStorage.setItem("gonogo.flightPlans", JSON.stringify([plan]));
        }, PLAN);
        await page.reload();
        await page.waitForTimeout(5_000);
        const skips = page.getByRole("button", { name: "Skip", exact: true });
        const total = await skips.count();
        for (let i = 0; i < total; i++) {
          await skips.nth(i).click();
          await page.waitForTimeout(300);
        }
        const carryOn = page.getByRole("button", { name: "Continue" });
        if (await carryOn.count()) await carryOn.click();
        await page.waitForTimeout(3_000);
      },
    },
    { capture: "01-vab-no-plan" },
    {
      name: "apply-in-vab",
      app: async (page) => {
        await page.getByRole("button", { name: "Apply plan" }).first().click();
        await page.getByText("Rig check, Mun").first().click();
        await page.getByRole("button", { name: "Apply", exact: true }).click();
        await page.waitForTimeout(2_000);
      },
    },
    { capture: "02-vab-applied" },
    { name: "launch-from-editor", input: `${LAUNCH}; sleep 2` },
    {
      name: "on-pad",
      wait: "vessel.identity",
      until: (p) => p.vesselId !== firstVesselId && p.situation === 2,
      timeoutS: 240,
    },
    { sleep: 10 },
    { capture: "03-pad-carried" },
    {
      name: "fallback-apply-in-flight",
      app: async (page) => {
        const none = await page.getByText("No plan applied").count();
        console.log(JSON.stringify({ carriedOver: none === 0 }));
        if (none === 0) return;
        await page.getByRole("button", { name: "Apply plan" }).first().click();
        await page.getByText("Rig check, Mun").first().click();
        await page.getByRole("button", { name: "Apply", exact: true }).click();
        await page.waitForTimeout(2_000);
      },
    },
    { capture: "04-pad-applied" },
    frameCost("pad", 30),
    { name: "sas-throttle", input: "key t; sleep 1; key z; sleep 1" },
    { name: "stage-1", input: "key space; sleep 2" },
    { wait: "vessel.flight", until: (p) => altitude(p) > 1_000, timeoutS: 90 },
    { capture: "05-climb-1km" },
    {
      wait: "vessel.flight",
      until: (p) => altitude(p) > 10_500,
      timeoutS: 240,
    },
    { capture: "06-launch-done-10km" },
    frameCost("climb", 20),
    { name: "stage-2", input: "key space; sleep 2", optional: true },
    {
      name: "past-intent",
      wait: "vessel.flight",
      until: (p) => altitude(p) > 32_000,
      timeoutS: 400,
      optional: true,
    },
    { capture: "07-ag2-late-32km" },
    { name: "fire-ag2", input: "key 2; sleep 2" },
    { capture: "08-ag2-fired" },
    teleport("kerbin", "Kerbin", 82, 90),
    { sleep: 15 },
    { capture: "09-kerbin-orbit" },
    frameCost("orbit", 30),
    teleport("mun", "Mun", 30, 40),
    { sleep: 15 },
    { capture: "10-mun-orbit" },
  ],
};
