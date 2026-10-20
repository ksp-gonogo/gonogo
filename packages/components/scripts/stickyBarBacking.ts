import type { Page } from "playwright";

/**
 * Does the scrolled panel body let rows show through the sticky bar at its
 * top (title, delay rail, filter or search control)? Hit-testing cannot say:
 * a transparent box still takes the pointer, so the answer is read from the
 * pixels. The bar's rectangle is drawn with the rest of the body scrolled
 * under it, then again with every other element of the body hidden, and the
 * two must be identical.
 *
 * Returns one line per problem, none when the bar hides what is under it. A
 * body with nothing scrolled beneath the bar is a problem too, so a fixture
 * too short to scroll cannot pass by never exercising the bar.
 */
export async function findContentUnderStickyBar(page: Page): Promise<string[]> {
  // No named helpers in the evaluate bodies: the bundler's name wrapper is undefined in the page.
  const prepared = await page.evaluate(() => {
    const body = document.querySelector("[data-panel-body]");
    const bar = document.querySelector("[data-panel-sticky-top]");
    if (!body || !bar) return { problem: "no sticky bar in the panel body" };
    if (body.scrollTop <= 0) {
      return {
        problem: "the body is not scrolled, so nothing is under the bar",
      };
    }
    const r = bar.getBoundingClientRect();
    const host = body.getBoundingClientRect();
    const x = Math.max(r.left, host.left);
    const y = Math.max(r.top, host.top);
    const width = Math.min(r.right, host.right) - x;
    const height = Math.min(r.bottom, host.bottom) - y;
    let under = 0;
    for (const el of Array.from(body.querySelectorAll("*"))) {
      if (bar.contains(el) || el.contains(bar)) continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      const overlaps =
        Math.min(b.right, x + width) > Math.max(b.left, x) &&
        Math.min(b.bottom, y + height) > Math.max(b.top, y);
      if (overlaps && el.children.length === 0) under += 1;
    }
    return { clip: { x, y, width, height }, under };
  });
  if ("problem" in prepared && prepared.problem) return [prepared.problem];
  const { clip, under } = prepared as {
    clip: { x: number; y: number; width: number; height: number };
    under: number;
  };
  if (under === 0) return ["no row is scrolled under the bar"];

  const withContent = await page.screenshot({ clip });
  await page.evaluate(() => {
    const body = document.querySelector("[data-panel-body]");
    const bar = document.querySelector("[data-panel-sticky-top]");
    if (!body || !bar) return;
    for (const el of Array.from(body.querySelectorAll("*"))) {
      if (bar.contains(el) || el.contains(bar)) continue;
      (el as HTMLElement).setAttribute("data-bar-probe-hidden", "");
      (el as HTMLElement).style.visibility = "hidden";
    }
  });
  const withoutContent = await page.screenshot({ clip });
  await page.evaluate(() => {
    for (const el of Array.from(
      document.querySelectorAll("[data-bar-probe-hidden]"),
    )) {
      (el as HTMLElement).style.visibility = "";
      el.removeAttribute("data-bar-probe-hidden");
    }
  });
  return withContent.equals(withoutContent)
    ? []
    : [`${under} row element(s) show through the sticky bar`];
}
