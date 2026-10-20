import type { Page } from "playwright";
import { PNG } from "pngjs";

/** Marks every element the second shot leaves out; set and cleared by {@link findCoveredEssentials}. */
const HIDDEN_ATTR = "data-probe-cover-hidden";

/** A channel has to move by more than this for a pixel to count as painted over, so antialiasing noise never does. */
const CHANNEL_DELTA = 48;

/** Device pixels that may change under an essential before it is reported. */
const PIXEL_TOLERANCE = 6;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface EssentialInk {
  label: string;
  boxes: Box[];
}

/**
 * Every figure, label and gauge of the kit's tiny form inside `scope` that
 * something else in the tile paints over, reported as
 * `"<essential text>" painted over: N px under <element>`. Null when the tile
 * does not show the tiny form.
 *
 * Measured from the pixels, since nothing in the DOM says it: the tile is shot
 * once as drawn and once with every element that neither holds an essential
 * nor sits inside one set to `opacity: 0`, and the two are compared inside the
 * essentials' ink boxes alone (their text's line boxes, their drawings and
 * their filled marks). Visibility leaves layout where it was, so the only
 * pixels that can differ there are ones another element painted on top.
 * A band the same colour as the panel reads as nothing in either shot of the
 * tile and as a sliced-off figure top in the comparison.
 */
export async function findCoveredEssentials(
  page: Page,
  scope = "#root",
): Promise<string[] | null> {
  const essentials = await page.evaluate((sel): EssentialInk[] | null => {
    const host = document.querySelector(sel);
    if (!host) return null;
    const found = Array.from(host.querySelectorAll("[data-tiny-essential]"));
    if (found.length === 0) return null;
    const bound = host.getBoundingClientRect();
    const out: EssentialInk[] = [];
    for (const essential of found) {
      const inked: Array<{ rect: DOMRect; from: Element }> = [];
      const walker = document.createTreeWalker(essential, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent?.trim() || !n.parentElement) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const rect of Array.from(range.getClientRects())) {
          inked.push({ rect, from: n.parentElement });
        }
      }
      for (const el of Array.from(essential.querySelectorAll("*"))) {
        const outermostSvg =
          el.localName === "svg" && !el.parentElement?.closest("svg");
        const filled =
          el instanceof HTMLElement &&
          !/rgba\(.*,\s*0\)|transparent/.test(
            getComputedStyle(el).backgroundColor,
          );
        if (outermostSvg || filled) {
          inked.push({ rect: el.getBoundingClientRect(), from: el });
        }
      }
      const boxes: Box[] = [];
      for (const { rect, from } of inked) {
        /*
         * Cut to every box on the way up that clips its overflow, so text
         * past an ellipsis and the words of a visually hidden label (a one
         * pixel box whose text still lays out at full width) count only
         * where they can actually be seen.
         */
        let x0 = Math.max(rect.left, bound.left);
        let y0 = Math.max(rect.top, bound.top);
        let x1 = Math.min(rect.right, bound.right);
        let y1 = Math.min(rect.bottom, bound.bottom);
        for (
          let el: Element | null = from;
          el && el !== host;
          el = el.parentElement
        ) {
          const cs = getComputedStyle(el);
          if (cs.overflowX === "visible" && cs.overflowY === "visible") {
            continue;
          }
          const r = el.getBoundingClientRect();
          x0 = Math.max(x0, r.left);
          y0 = Math.max(y0, r.top);
          x1 = Math.min(x1, r.right);
          y1 = Math.min(y1, r.bottom);
        }
        // Anything a pixel or two across is a screen-reader-only box, which shows nothing to anyone sighted.
        if (x1 - x0 <= 2 || y1 - y0 <= 2) continue;
        boxes.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      }
      if (boxes.length === 0) continue;
      out.push({
        label: (essential.textContent ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 32),
        boxes,
      });
    }
    return out;
  }, scope);
  if (essentials === null) return null;
  const all = essentials.flatMap((e) => e.boxes);
  if (all.length === 0) return [];

  const left = Math.floor(Math.min(...all.map((b) => b.x)));
  const top = Math.floor(Math.min(...all.map((b) => b.y)));
  const clip = {
    x: left,
    y: top,
    width: Math.ceil(Math.max(...all.map((b) => b.x + b.w))) - left,
    height: Math.ceil(Math.max(...all.map((b) => b.y + b.h))) - top,
  };

  const drawn = PNG.sync.read(await page.screenshot({ clip }));
  await page.evaluate(
    ([sel, attr]) => {
      const host = document.querySelector(sel);
      if (!host) return;
      if (!document.getElementById("probe-cover-style")) {
        const style = document.createElement("style");
        style.id = "probe-cover-style";
        style.textContent = `[${attr}] { opacity: 0 !important; transition: none !important; }`;
        document.head.append(style);
      }
      const keep = Array.from(host.querySelectorAll("[data-tiny-essential]"));
      for (const el of Array.from(host.querySelectorAll("*"))) {
        if (keep.some((k) => k.contains(el) || el.contains(k))) continue;
        el.setAttribute(attr, "");
      }
    },
    [scope, HIDDEN_ATTR] as const,
  );
  const alone = PNG.sync.read(await page.screenshot({ clip }));

  const scale = drawn.width / clip.width;
  const out: string[] = [];
  for (const essential of essentials) {
    let covered = 0;
    let firstAt: { x: number; y: number } | undefined;
    for (const b of essential.boxes) {
      const x0 = Math.max(0, Math.floor((b.x - clip.x) * scale));
      const y0 = Math.max(0, Math.floor((b.y - clip.y) * scale));
      const x1 = Math.min(drawn.width, Math.ceil((b.x + b.w - clip.x) * scale));
      const y1 = Math.min(
        drawn.height,
        Math.ceil((b.y + b.h - clip.y) * scale),
      );
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * drawn.width + x) * 4;
          const delta = Math.max(
            Math.abs(drawn.data[i] - alone.data[i]),
            Math.abs(drawn.data[i + 1] - alone.data[i + 1]),
            Math.abs(drawn.data[i + 2] - alone.data[i + 2]),
          );
          if (delta <= CHANNEL_DELTA) continue;
          covered++;
          firstAt ??= { x: clip.x + x / scale, y: clip.y + y / scale };
        }
      }
    }
    if (covered <= PIXEL_TOLERANCE || !firstAt) continue;
    const by = await page.evaluate(
      ([at, attr]) => {
        const hit = document
          .elementsFromPoint(at.x, at.y)
          .find((el) => el.hasAttribute(attr));
        if (!hit) return "an element outside the tiny form";
        const data = hit
          .getAttributeNames()
          .filter((n) => n.startsWith("data-") && n !== attr);
        return `<${hit.localName}${data.map((n) => ` ${n}`).join("")}>`;
      },
      [firstAt, HIDDEN_ATTR] as const,
    );
    out.push(`"${essential.label}" painted over: ${covered} px under ${by}`);
  }

  await page.evaluate((attr) => {
    for (const el of Array.from(document.querySelectorAll(`[${attr}]`))) {
      el.removeAttribute(attr);
    }
  }, HIDDEN_ATTR);
  return out;
}

/**
 * Plants a tiny figure with a band the colour of its own background laid over
 * its top, and the same figure under a transparent band beside an opaque dot,
 * and requires {@link findCoveredEssentials} to report the first and pass the
 * second. A detector that cannot see the plant reports nothing and nothing
 * reads as a pass.
 */
export async function proveCoverDetectorWorks(page: Page): Promise<void> {
  const plant = async (band: string) => {
    await page.evaluate((bandColour) => {
      document.getElementById("cover-detector-selfcheck")?.remove();
      const box = document.createElement("div");
      box.id = "cover-detector-selfcheck";
      box.setAttribute(
        "style",
        "position:fixed;top:0;left:0;width:240px;height:120px;z-index:2147483647;background:#0d0d0d",
      );
      box.innerHTML = `
        <div data-tiny-essential="" style="padding-top:10px;font:48px/1 monospace;color:#ddd">450kf</div>
        <div style="position:absolute;top:0;left:0;right:0;height:30px;background:${bandColour}"></div>
        <div style="position:absolute;top:20px;left:200px;width:16px;height:16px;background:#f80"></div>
      `;
      document.body.append(box);
    }, band);
    const found = await findCoveredEssentials(
      page,
      "#cover-detector-selfcheck",
    );
    await page.evaluate(() =>
      document.getElementById("cover-detector-selfcheck")?.remove(),
    );
    return found;
  };

  const covered = await plant("#0d0d0d");
  if (!covered || covered.length === 0) {
    throw new Error(
      "The covered-figure detector is BLIND: a band the colour of the tile " +
        "laid over the top of a planted tiny figure was not reported, so a " +
        "clean run proves nothing about the widgets.",
    );
  }
  const clear = await plant("transparent");
  if (clear === null || clear.length > 0) {
    throw new Error(
      "The covered-figure detector reported a planted tiny figure under a " +
        "transparent band beside an opaque dot, which covers nothing, so its " +
        "verdict on a real tiny form cannot be trusted either: " +
        (clear?.join("; ") ?? "it did not see the figure at all"),
    );
  }
}
