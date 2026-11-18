/* Throwaway: drives the design demo against the fake design mod and records it. */
import { mkdirSync, readFileSync, renameSync } from "node:fs";
import { chromium } from "@playwright/test";
import { sendCommand } from "./sitrep-command.mjs";

const outDir = process.argv[2] ?? ".renders/designspike/demo";
const fixture = JSON.parse(
  readFileSync(process.argv[3] ?? ".builds/fake/fixture-real.json", "utf8"),
);
const host = process.argv[4] ?? "127.0.0.1";
const port = Number(process.argv[5] ?? 8199);
const appUrl = process.argv[6] ?? "http://localhost:5291/";
mkdirSync(outDir, { recursive: true });
const panel = (i, componentId, x, y, w, h, config) => ({
  item: { i, componentId, ...(config ? { config } : {}) },
  layout: { i, x, y, w, h },
});
const editor = [
  panel("schematic", "vessel-schematic", 0, 0, 9, 24),
  panel("predict", "design-flight-prediction", 9, 0, 17, 24),
  panel("bench", "kos-design-bench", 26, 0, 10, 24),
];
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1700, height: 1000 },
  recordVideo: { dir: outDir, size: { width: 1700, height: 1000 } },
});
const page = await context.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.log("console", m.text().slice(0, 400));
});
await page.addInitScript(
  (entries) => {
    for (const [k, v] of entries) localStorage.setItem(k, v);
  },
  [
    ["gonogo.datasource.sitrep", JSON.stringify({ host, port })],
    ["gonogo.uplinkHubWizard.firstRunSeen", "1"],
    [
      "gonogo:dashboard:main:Editor",
      JSON.stringify({
        items: editor.map((p) => p.item),
        layout: editor.map((p) => p.layout),
      }),
    ],
  ],
);

let shot = 0;
const snap = async (name) =>
  page.screenshot({
    path: `${outDir}/${String(++shot).padStart(2, "0")}-${name}.png`,
  });
const caption = async (text) => {
  await page.evaluate((t) => {
    let el = document.getElementById("demo-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-caption";
      Object.assign(el.style, {
        position: "fixed",
        left: "24px",
        bottom: "20px",
        zIndex: 99999,
        padding: "8px 14px",
        background: "rgba(0,0,0,0.85)",
        color: "#fff",
        font: "15px monospace",
        border: "1px solid #5fc8ff",
        borderRadius: "4px",
        maxWidth: "1100px",
      });
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
};
const pause = (s) => page.waitForTimeout(s * 1000);
const moment = (name) =>
  console.log(`MOMENT ${name} ${new Date().toISOString()}`);
const bench = page.locator("textarea[aria-label='Boot script']");
const press = async (name) => {
  const item = page.getByRole("menuitem", { name });
  if (await item.count()) await item.first().click();
  else await page.getByRole("button", { name }).first().click();
  await pause(0.4);
  const confirm = page.getByRole("button", { name: /^(Confirm|Send)/ });
  if (await confirm.count()) await confirm.first().click();
};

await page.goto(`${appUrl}?uplinkLoaderIds=design,kos`);
await pause(5);
if (process.env.NUDGE_CPU) {
  /* The real mod publishes on an edit only, so re-set the CPU's current tag once the page has subscribed. */
  const r = await sendCommand({
    url: `ws://${host}:${port}/`,
    command: "design.kos.setTag",
    args: {
      partId: process.env.NUDGE_CPU,
      nameTag: process.env.NUDGE_TAG ?? "",
    },
  });
  console.log("nudge", r.outcome);
  await page.locator("#kos-bench-tag").waitFor({ timeout: 20000 });
  await pause(2);
}
await caption(
  "A craft on the VAB floor, drawn as a design: no program on its kOS CPU yet",
);
await pause(3);
await snap("start");

await caption("Name the kOS CPU");
await page.fill("#kos-bench-tag", "flight");
await pause(1);
await press("Name CPU");
moment("tag");
await pause(4);

await caption("Write the boot script and deploy it to the CPU");
await bench.fill(fixture.v1);
await pause(2);
await press(/Deploy to/);
moment("deploy");
await pause(3);
await caption(
  "The prediction runs the deployed script: under the FAR fit the capsule falls nose first and hits the water too fast",
);
await pause(4);
await snap("v1-likely");

await caption(
  "Pitfall (a): stock the FL-T400 at 50% from the Vessel Schematic",
);
/* Part ids are regenerated on every reload and undo in the editor, so the tank is found by its title. */
const tank = page.locator("[aria-label*='FL-T400'][role='button']").first();
await tank.click();
await pause(1.5);
await snap("part-menu");
await press(/^Propellant 50%/);
moment("half");
await pause(5);
await caption(
  "Delta-v drops and the predicted path falls short onto land in every run",
);
await pause(4);
await snap("tank50");

await caption("Restock the tank");
await tank.click();
await pause(1);
await press(/^Propellant 100%/);
moment("restock");
await pause(5);
await snap("restocked");

await caption(
  "Pitfall (b): a script edit that drops the STAGE lighting the Swivel",
);
await bench.fill(fixture.v2);
await pause(2);
await press(/Deploy to/);
moment("deploy2");
await pause(3);
await caption(
  "Every later STAGE now fires one stage late: the tank rides down and the parachute stage never fires",
);
await pause(5);
await snap("v2");

await caption("Restore the first script");
await bench.fill(fixture.v1);
await pause(1);
await press(/Deploy to/);
await pause(4);
await snap("final");

const video = await page.video().path();
await context.close();
await browser.close();
renameSync(video, `${outDir}/demo.webm`);
console.log("video", `${outDir}/demo.webm`);
