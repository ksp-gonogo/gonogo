/* Throwaway: the main screen and the pilot screen in the editor, against a given mod port. */
import { chromium } from "@playwright/test";

const [
  out = ".renders/designspike/deck-pilot",
  port = "18090",
  app = "http://localhost:5291/",
] = process.argv.slice(2);
const panel = (i, componentId, x, y, w, h, config) => ({
  item: { i, componentId, ...(config ? { config } : {}) },
  layout: { i, x, y, w, h },
});
const layout = [
  panel("flight", "vessel-schematic", 0, 0, 9, 22),
  panel("design", "vessel-schematic", 9, 0, 9, 22),
  panel("predict", "design-flight-prediction", 18, 0, 18, 22),
];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 950 } });
await page.addInitScript(
  (entries) => {
    for (const [k, v] of entries) localStorage.setItem(k, v);
  },
  [
    [
      "gonogo.datasource.sitrep",
      JSON.stringify({ host: "127.0.0.1", port: Number(port) }),
    ],
    ["gonogo.uplinkHubWizard.firstRunSeen", "1"],
    [
      "gonogo:dashboard:main:Editor",
      JSON.stringify({
        items: layout.map((p) => p.item),
        layout: layout.map((p) => p.layout),
      }),
    ],
  ],
);
await page.goto(`${app}?uplinkLoaderIds=design,kos`);
await page.waitForTimeout(8000);
await page.screenshot({ path: `${out}-main.png` });
await page.getByRole("button", { name: /Switch to pilot/ }).click();
await page.waitForTimeout(1000);
await page
  .getByRole("dialog")
  .getByRole("button", { name: /Switch to pilot/ })
  .click();
await page.waitForTimeout(6000);
await page.screenshot({ path: `${out}-pilot.png` });
await page
  .getByRole("button", { name: /Add a widget/ })
  .click()
  .catch(() => {});
await page.waitForTimeout(1500);
await page.keyboard.type("design");
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}-pilot-picker.png` });
await browser.close();
