/**
 * A command sent while a KSC building holds the game clock still, then the
 * building closed, watched in the game, on the wire and in the app.
 *
 * Needs a save loaded at the Space Center (`rp1-deck-t1` on the RP-1 rig; any
 * throwaway career save elsewhere). The building buttons are RP-1's left-hand
 * column, Administration at the top. The save must hold an active
 * `leaderKorolevEngineering`, the leader the wire command deactivates.
 */
const ADMIN_BUTTON = "click 37 309";

const panel = (i, componentId, x, y, w, h, config) => ({
  item: { i, componentId, ...(config ? { config } : {}) },
  layout: { i, x, y, w, h },
});

const spaceCenter = [
  panel("warp", "warp-control", 0, 0, 12, 10),
  panel("scs", "space-center-status", 12, 0, 12, 16),
  panel("admin", "strategies", 24, 0, 12, 24),
  panel("funding", "career-economy", 0, 10, 12, 14),
];

export default {
  name: "ksc-building-freeze",
  topics: ["time.warp", "career.status", "spaceCenter.scene", "system.uplinks"],
  dashboards: {
    SpaceCenter: {
      items: spaceCenter.map((p) => p.item),
      layouts: { lg: spaceCenter.map((p) => p.layout) },
    },
  },
  steps: [
    { name: "clock", wait: "time.warp", timeoutS: 60 },
    { sleep: 8 },
    { capture: "01-ksc-idle" },
    { name: "open-admin", input: `${ADMIN_BUTTON}; sleep 4` },
    { capture: "02-admin-open" },
    {
      name: "warp-from-app",
      app: async (page) => {
        await page.getByRole("button", { name: "Warp up" }).first().click();
      },
      optional: true,
    },
    { sleep: 5 },
    { capture: "03-warp-sent-frozen" },
    {
      name: "deactivate-on-the-wire",
      command: "career.strategy.deactivate",
      args: { strategyId: "leaderKorolevEngineering" },
      timeoutS: 15,
      giveUpS: 180,
      background: true,
    },
    { sleep: 20 },
    { capture: "04-wire-command-unconfirmed" },
    { name: "close-admin", input: "key Escape; sleep 4" },
    { sleep: 6 },
    { capture: "05-admin-closed" },
    {
      name: "leader-gone",
      wait: "career.status",
      until: (p) =>
        !p.strategies.active.some((s) => s.id === "leaderKorolevEngineering"),
      timeoutS: 120,
      optional: true,
    },
    { capture: "06-settled" },
  ],
};
