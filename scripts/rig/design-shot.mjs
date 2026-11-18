/* Throwaway: opens the app against the fake design mod with a design dashboard seeded, and screenshots it. */
import { chromium } from "@playwright/test";

const out = process.argv[2] ?? ".renders/designspike/shot.png";
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
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning")
    console.log("console", m.type(), m.text().slice(0, 3000));
});
await page.addInitScript(
  (entries) => {
    for (const [k, v] of entries) localStorage.setItem(k, v);
  },
  [
    [
      "gonogo.datasource.sitrep",
      JSON.stringify({ host: "127.0.0.1", port: 8199 }),
    ],
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
await page.goto("http://localhost:5291/?uplinkLoaderIds=design,kos");
await page.waitForTimeout(6000);
await page.screenshot({ path: out });
console.log(
  await page
    .locator("body")
    .innerText()
    .then((t) => t.slice(0, 1500)),
);
await browser.close();
