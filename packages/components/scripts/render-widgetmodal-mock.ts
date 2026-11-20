#!/usr/bin/env tsx
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { prepareProbePage } from "./widgetRenderHarness";

/**
 * Drives the real dashboard tile chrome (`GridItemContent`) around a real
 * widget and photographs Expand: the top bar, the dialog, and a widget whose
 * typed text and scroll position must survive the trip into the dialog and
 * back. Fails when anything it asserts does not hold.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] ?? ".renders/widgetmodal2");

const GRAPH_CONFIG = {
  windowSec: 600,
  series: [
    {
      id: "alt",
      key: "vessel.flight.altitudeAsl",
      label: "Altitude",
      axis: "primary",
    },
    {
      id: "ospd",
      key: "vessel.flight.orbitalSpeed",
      label: "Orbital speed",
      axis: "secondary",
    },
  ],
};

function check(ok: boolean, what: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const html = await prepareProbePage({
    entry: join(HERE, "widgetmodal-probe/entry.tsx"),
    htmlTemplate: join(HERE, "widgetmodal-probe/probe.html"),
    scriptSrcPlaceholder:
      '<script type="module" src="./entry.bundle.js"></script>',
    slug: "widgetmodal",
    /* The tile chrome imports the components package by name, which would load its built copy beside the source the probe mounts. */
    alias: {
      "@ksp-gonogo/components": resolve(HERE, "../src/index.ts"),
    },
  } as never);
  const fixture = JSON.parse(
    await readFile(
      join(HERE, "../src/Graph/__fixtures__/ascent-altitude-velocity.json"),
      "utf8",
    ),
  );
  const browser = await chromium.launch();
  const open = async (
    w: number,
    h: number,
    widgetId: string,
    tile: { w: number; h: number; px: number; py: number },
    config = {},
    fx: Record<string, unknown> = {},
  ) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.error("pageerror", e.message));
    page.on(
      "console",
      (m) => m.type() === "error" && console.error("console", m.text()),
    );
    await page.goto(`file://${html}`);
    await page.waitForFunction(() => "__mock" in window);
    await page.evaluate(
      (p) =>
        (window as never as { __mock: (x: unknown) => Promise<void> }).__mock(
          p,
        ),
      {
        widgetId,
        fixture: { ...fx, _sitrepHost: true },
        config,
        w: tile.w,
        h: tile.h,
        pxW: tile.px,
        pxH: tile.py,
      },
    );
    await page.waitForTimeout(1200);
    return page;
  };
  const shot = (page: Page, name: string) =>
    page.screenshot({ path: join(OUT, `${name}.png`) });

  // Graph: the top bar and the dialog at two widths
  for (const [vw, vh, tag] of [
    [1440, 900, "1440"],
    [1024, 768, "1024"],
  ] as const) {
    const page = await open(
      vw,
      vh,
      "graph",
      { w: 14, h: 11, px: 520, py: 343 },
      GRAPH_CONFIG,
      fixture,
    );
    if (tag === "1440") {
      await page.hover('button[aria-label="Expand Graph"]', { force: true });
      await page.waitForTimeout(600);
      await page.screenshot({
        path: join(OUT, "01-top-bar.png"),
        clip: { x: 0, y: 0, width: 640, height: 420 },
      });
      const order = await page.$$eval(".widget-action-buttons button", (bs) =>
        bs.map((b) => b.getAttribute("aria-label")),
      );
      check(
        order[0] === "Expand Graph",
        `Expand is the leftmost button (${order.join(" | ")})`,
      );
    }
    const before = await page.evaluate(() =>
      Math.max(
        0,
        ...Array.from(document.querySelectorAll("#root [data-panel-body]")).map(
          (e) => e.getBoundingClientRect().width,
        ),
      ),
    );
    await page.click('button[aria-label="Expand Graph"]', { force: true });
    await page.waitForTimeout(1500);
    await shot(page, `0${tag === "1440" ? 2 : 3}-graph-dialog-${tag}`);
    if (tag === "1440") {
      await page.hover('[role="dialog"] button[aria-label="Push to main"]', {
        force: true,
      });
      await page.waitForTimeout(700);
      await shot(page, "graph-dialog-1440-tip");
      await page.mouse.move(700, 500);
      await page.waitForTimeout(500);
      await shot(page, "graph-dialog-1440-rest");
    }
    const after = await page.evaluate(() =>
      Math.max(
        0,
        ...Array.from(
          document.querySelectorAll('[role="dialog"] [data-panel-body]'),
        ).map((e) => e.getBoundingClientRect().width),
      ),
    );
    check(
      after > before,
      `${tag}: the Graph panel is given the dialog's width (${Math.round(before)} -> ${Math.round(after)} px)`,
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    check(
      await page.evaluate(
        () => document.querySelectorAll('[role="dialog"]').length === 0,
      ),
      `${tag}: Esc closes the dialog`,
    );
    const focused = await page.evaluate(() =>
      document.activeElement?.getAttribute("aria-label"),
    );
    check(
      focused === "Expand Graph",
      `${tag}: focus returns to the Expand button (${focused})`,
    );
    const back = await page.evaluate(() =>
      Math.max(
        0,
        ...Array.from(document.querySelectorAll("#root [data-panel-body]")).map(
          (e) => e.getBoundingClientRect().width,
        ),
      ),
    );
    check(
      Math.abs(back - before) < 2,
      `${tag}: the Graph panel is back at the tile width (${Math.round(back)} px)`,
    );
    await page.context().close();
  }

  // Notepad: text, scroll, selection and instance survive the round trip
  const page = await open(1440, 900, "notepad", {
    w: 10,
    h: 10,
    px: 360,
    py: 310,
  });
  await page.fill(
    'textarea[aria-label="Draft"]',
    "A draft typed before expanding",
  );
  await page.evaluate(() => {
    const ta = document.querySelector("textarea") as HTMLTextAreaElement;
    ta.setSelectionRange(2, 7);
    (ta as unknown as { __tag: number }).__tag = 42;
    (
      document.querySelector('[data-testid="scroller"]') as HTMLElement
    ).scrollTop = 200;
  });
  await page.mouse.move(700, 600);
  await shot(page, "04-notepad-tile");
  await page.click('button[aria-label="Expand Notepad"]', { force: true });
  await page.waitForTimeout(800);
  await shot(page, "05-notepad-dialog");
  await page.hover('[role="dialog"] button[aria-label="Push to main"]', {
    force: true,
  });
  await page.waitForTimeout(700);
  await shot(page, "notepad-dialog-tip");
  await page.mouse.move(700, 500);
  await page.waitForTimeout(500);
  const inside = await page.evaluate(() => {
    const ta = document.querySelector('[role="dialog"] textarea') as
      | (HTMLTextAreaElement & { __tag?: number })
      | null;
    const sc = document.querySelector(
      '[role="dialog"] [data-testid="scroller"]',
    ) as HTMLElement | null;
    return {
      sameNode: ta?.__tag === 42,
      value: ta?.value,
      sel: ta ? [ta.selectionStart, ta.selectionEnd] : null,
      scroll: sc?.scrollTop,
      facts: document.querySelector('[role="dialog"] [data-testid="facts"]')
        ?.textContent,
      push: !!document.querySelector(
        '[role="dialog"] button[aria-label="Push to main"]',
      ),
    };
  });
  check(
    inside.sameNode,
    "the textarea in the dialog is the same node as in the tile",
  );
  check(
    inside.value === "A draft typed before expanding",
    "typed text is in the dialog",
  );
  check(
    inside.sel?.[0] === 2 && inside.sel?.[1] === 7,
    `selection kept (${inside.sel})`,
  );
  check(
    (inside.scroll ?? 0) >= 190,
    `scroll offset kept in the dialog (${inside.scroll})`,
  );
  check(inside.push === true, "the push button is in the dialog");
  const row = await page.evaluate(() => {
    const push = document
      .querySelector('[role="dialog"] button[aria-label="Push to main"]')
      ?.getBoundingClientRect();
    const close = document
      .querySelector('[role="dialog"] button[aria-label="Close"]')
      ?.getBoundingClientRect();
    return push && close
      ? {
          sameRow: Math.abs(push.top - close.top) < 12,
          sameSize: push.width === close.width && push.height === close.height,
          size: [push.width, push.height, close.width, close.height],
          left: push.right <= close.left,
        }
      : null;
  });
  check(
    row?.sameRow === true && row.left === true && row.sameSize === true,
    `the push button sits in a row with Close, to its left, at the same size (${row?.size})`,
  );
  check(
    /instance 1,/.test(inside.facts ?? ""),
    `still instance 1 (${inside.facts})`,
  );
  await page.fill(
    '[role="dialog"] textarea',
    "A draft typed before expanding, and after",
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  const outside = await page.evaluate(() => {
    const ta = document.querySelector("textarea") as
      | (HTMLTextAreaElement & { __tag?: number })
      | null;
    const sc = document.querySelector(
      '[data-testid="scroller"]',
    ) as HTMLElement | null;
    return {
      sameNode: ta?.__tag === 42,
      value: ta?.value,
      scroll: sc?.scrollTop,
      facts: document.querySelector('[data-testid="facts"]')?.textContent,
      focus: document.activeElement?.getAttribute("aria-label"),
    };
  });
  check(outside.sameNode, "back in the tile, still the same textarea node");
  check(
    outside.value === "A draft typed before expanding, and after",
    "text typed in the dialog is in the tile",
  );
  check(
    (outside.scroll ?? 0) >= 190,
    `scroll offset kept back in the tile (${outside.scroll})`,
  );
  check(
    /instance 1, 10 x 10/.test(outside.facts ?? ""),
    `never remounted, tile size again (${outside.facts})`,
  );
  check(
    outside.focus === "Expand Notepad",
    `focus on the Expand button (${outside.focus})`,
  );
  await shot(page, "06-notepad-back");
  await browser.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
