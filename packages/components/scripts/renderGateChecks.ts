/**
 * Checks the render gate runs on a laid-out widget beyond the harness's older
 * detectors: SVG text against HTML text, text an operator would click that no
 * control receives, and controls that move when another control is pressed.
 *
 * Each has a `prove...Works` that plants a case it must report and a case it
 * must leave alone before any widget renders, because a detector that cannot
 * see its own failure reports zero and zero reads as a pass.
 *
 * The functions passed to `page.evaluate` use no named inner helpers: the
 * script runner wraps those in a `__name` call that does not exist in the page.
 */
import type { Page } from "playwright";

/** Pixels two text boxes may share before it counts as a collision. */
const TEXT_OVERLAP_TOLERANCE_PX = 2;

/**
 * Every SVG `<text>` under `#root` whose drawn glyphs share pixels with a line
 * of HTML text, reported as `<text> "a" ⨯ html "b" overlap Npx`.
 *
 * The SVG-only walk cannot see a chart caption that an HTML legend, notice or
 * tooltip is laid over, and the HTML stack walk skips SVG outright, so a pair
 * drawn in different media was compared by nothing. An HTML text box is one
 * line fragment of a text node, cut down to the clipping ancestors that show
 * it, so a line that is scrolled out of view or wrapped away does not count.
 */
export async function findSvgHtmlTextOverlaps(page: Page): Promise<string[]> {
  return page.evaluate(
    ([tolerance]) => {
      const host = document.getElementById("root");
      if (!host) return [] as string[];
      const svgNs = "http://www.w3.org/2000/svg";

      type Quad = number[][];
      const svgTexts: { text: string; quad: Quad }[] = [];
      for (const el of Array.from(host.querySelectorAll("svg text"))) {
        const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        if (text === "") continue;
        let hidden = false;
        for (let n: Element | null = el; n && n !== host; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (
            s.display === "none" ||
            s.visibility === "hidden" ||
            s.opacity === "0"
          ) {
            hidden = true;
            break;
          }
        }
        if (hidden) continue;
        const box = (el as SVGGraphicsElement).getBBox();
        const toScreen = (el as SVGGraphicsElement).getScreenCTM();
        if (box.width <= 0 || box.height <= 0 || !toScreen) continue;
        const quad: Quad = [];
        for (const [cx, cy] of [
          [box.x, box.y],
          [box.x + box.width, box.y],
          [box.x + box.width, box.y + box.height],
          [box.x, box.y + box.height],
        ]) {
          quad.push([
            toScreen.a * cx + toScreen.c * cy + toScreen.e,
            toScreen.b * cx + toScreen.d * cy + toScreen.f,
          ]);
        }
        svgTexts.push({ text, quad });
      }
      if (svgTexts.length === 0) return [] as string[];

      const htmlTexts: { text: string; quad: Quad }[] = [];
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
        const owner = node.parentElement;
        if (text === "" || !owner) continue;
        if (owner.namespaceURI === svgNs || owner.closest("svg")) continue;
        let visible = true;
        for (
          let n: Element | null = owner;
          n && n !== host;
          n = n.parentElement
        ) {
          const s = getComputedStyle(n);
          if (
            s.display === "none" ||
            s.visibility === "hidden" ||
            s.opacity === "0"
          ) {
            visible = false;
            break;
          }
        }
        if (!visible) continue;
        range.selectNodeContents(node);
        for (const r of Array.from(range.getClientRects())) {
          if (r.width <= 0 || r.height <= 0) continue;
          let x0 = r.left;
          let y0 = r.top;
          let x1 = r.right;
          let y1 = r.bottom;
          for (
            let n: Element | null = owner;
            n && n !== host;
            n = n.parentElement
          ) {
            const s = getComputedStyle(n);
            if (
              !/hidden|clip|auto|scroll/.test(`${s.overflowX} ${s.overflowY}`)
            ) {
              continue;
            }
            const c = n.getBoundingClientRect();
            x0 = Math.max(x0, c.left);
            y0 = Math.max(y0, c.top);
            x1 = Math.min(x1, c.right);
            y1 = Math.min(y1, c.bottom);
          }
          if (x1 <= x0 || y1 <= y0) continue;
          htmlTexts.push({
            text,
            quad: [
              [x0, y0],
              [x1, y0],
              [x1, y1],
              [x0, y1],
            ],
          });
        }
      }

      const out: string[] = [];
      for (const a of svgTexts) {
        for (const b of htmlTexts) {
          let depth = Number.POSITIVE_INFINITY;
          for (const quad of [a.quad, b.quad]) {
            for (let k = 0; k < 2; k++) {
              const ex = quad[k + 1][0] - quad[k][0];
              const ey = quad[k + 1][1] - quad[k][1];
              const len = Math.hypot(ex, ey) || 1;
              const nx = -ey / len;
              const ny = ex / len;
              let aMin = Number.POSITIVE_INFINITY;
              let aMax = Number.NEGATIVE_INFINITY;
              let bMin = Number.POSITIVE_INFINITY;
              let bMax = Number.NEGATIVE_INFINITY;
              for (const pt of a.quad) {
                const d = pt[0] * nx + pt[1] * ny;
                aMin = Math.min(aMin, d);
                aMax = Math.max(aMax, d);
              }
              for (const pt of b.quad) {
                const d = pt[0] * nx + pt[1] * ny;
                bMin = Math.min(bMin, d);
                bMax = Math.max(bMax, d);
              }
              depth = Math.min(
                depth,
                Math.min(aMax, bMax) - Math.max(aMin, bMin),
              );
            }
          }
          if (depth <= tolerance) continue;
          out.push(
            `<text> "${a.text.slice(0, 32)}" ⨯ html "${b.text.slice(0, 32)}" overlap ${depth.toFixed(1)}px`,
          );
        }
      }
      return out;
    },
    [TEXT_OVERLAP_TOLERANCE_PX] as const,
  );
}

/**
 * Plants an HTML line laid over a chart caption, which must be reported, and
 * HTML text beside, below and clipped away from captions, which must not.
 */
export async function proveSvgHtmlOverlapWorks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = document.getElementById("root");
    if (!host) throw new Error("Probe: #root missing before the check");
    const box = document.createElement("div");
    box.id = "svg-html-selfcheck";
    box.innerHTML = `
      <div style="position:absolute;top:1100px;left:0;width:260px;height:120px">
        <svg width="260" height="120" style="position:absolute;top:0;left:0">
          <text x="4" y="14" font-size="10">FIRES-CAPTION</text>
          <text x="4" y="54" font-size="10">QUIET-BESIDE-CAPTION</text>
          <text x="4" y="94" font-size="10">QUIET-CLIPPED-CAPTION</text>
        </svg>
        <div style="position:absolute;top:2px;left:6px;font-size:12px">fires-legend</div>
        <div style="position:absolute;top:44px;left:170px;font-size:12px">quiet-aside</div>
        <div style="position:absolute;top:84px;left:0;width:60px;height:4px;overflow:hidden">
          <div style="font-size:12px;margin-top:20px">quiet-scrolled-away</div>
        </div>
      </div>`;
    host.appendChild(box);
  });
  const found = await findSvgHtmlTextOverlaps(page);
  await page.evaluate(() =>
    document.getElementById("svg-html-selfcheck")?.remove(),
  );
  if (
    !found.some(
      (f) => f.includes("FIRES-CAPTION") && f.includes("fires-legend"),
    )
  ) {
    throw new Error(
      "The SVG-text against HTML-text detector is BLIND: a legend line laid over a chart caption was not reported, so a clean run proves nothing about the charts.\n" +
        `What it did report: ${found.length === 0 ? "nothing" : found.join("; ")}`,
    );
  }
  const misfired = found.filter((f) => f.includes("QUIET"));
  if (misfired.length > 0) {
    throw new Error(
      "The SVG-text against HTML-text detector reported text that does not overlap:\n  " +
        misfired.join("\n  "),
    );
  }
}

/** Most direct children a container may have and still read as one row of a control and its text. */
const MAX_ROW_ITEMS = 5;

/** What a pointer press can act on, by element. */
const CONTROL_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  '[role="button"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="menuitem"]',
  '[role="option"]',
].join(",");

/**
 * Every line of visible text that sits in a row holding a control and is not
 * itself a control, where a press at the middle of the text lands on nothing
 * that acts, reported as `"text" beside "control" lands on <tag>`.
 *
 * A row is the nearest ancestor of the text with a control among its direct
 * children. Text drawn next to a control reads as part of it, so a press on it
 * that does nothing looks like a broken control to an operator, and a test that
 * finds the control by its accessible name never presses the text at all.
 */
export async function findDeadTextTargets(page: Page): Promise<string[]> {
  return page.evaluate(
    ([controlSelector, maxRowItems]) => {
      const host = document.getElementById("root");
      if (!host) return [] as string[];
      const out: string[] = [];
      const seen = new Set<string>();
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
        const owner = node.parentElement;
        if (text === "" || !owner) continue;
        if (owner.closest(controlSelector) || owner.closest("svg")) continue;
        let visible = true;
        for (
          let n: Element | null = owner;
          n && n !== host;
          n = n.parentElement
        ) {
          const s = getComputedStyle(n);
          if (
            s.display === "none" ||
            s.visibility === "hidden" ||
            s.opacity === "0"
          ) {
            visible = false;
            break;
          }
        }
        if (!visible) continue;

        // The row is the nearest ancestor with a control among its direct children, and a row is a few items on one line: the text's own branch must sit directly beside the control.
        let row: Element | null = owner;
        let control: Element | undefined;
        let branch: Element = owner;
        for (; row && row !== host; branch = row, row = row.parentElement) {
          if (!row.parentElement) break;
          const kids = Array.from(row.children);
          if (kids.length > maxRowItems) continue;
          control = kids.find(
            (c) =>
              c !== branch &&
              c.matches(controlSelector) &&
              c.getClientRects().length > 0 &&
              Math.abs(kids.indexOf(c) - kids.indexOf(branch)) === 1,
          );
          if (control) break;
        }
        if (!row || !control) continue;

        range.selectNodeContents(node);
        const rects = Array.from(range.getClientRects()).filter(
          (r) => r.width > 0 && r.height > 0,
        );
        if (rects.length === 0) continue;
        const r = rects[0];
        const cr = control.getBoundingClientRect();
        if (r.bottom <= cr.top || r.top >= cr.bottom) continue;
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight)
          continue;
        const hit = document.elementFromPoint(x, y);
        // Off the tile, or text no eye reads (clipped to a pixel for a screen reader), is not a press target.
        if (!hit || !host.contains(hit) || r.height < 6) continue;
        if (hit.closest(controlSelector)) continue;
        // A press that lands on a row whose own handler acts is still a press that acts; a control higher up wraps the row.
        if (row.closest(controlSelector)) continue;
        const key = `${text}|${hit.tagName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const label = (
          control.getAttribute("aria-label") ??
          control.textContent ??
          ""
        )
          .replace(/\s+/g, " ")
          .trim();
        out.push(
          `"${text.slice(0, 32)}" beside "${label.slice(0, 24)}" lands on <${hit.tagName.toLowerCase()}>`,
        );
      }
      return out;
    },
    [CONTROL_SELECTOR, MAX_ROW_ITEMS] as const,
  );
}

/**
 * Plants a title beside a button that no press can reach, which must be
 * reported, and a title that is part of its button, a label for one and a line
 * in a row with no control, which must not.
 */
export async function proveHitTargetCheckWorks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = document.getElementById("root");
    if (!host) throw new Error("Probe: #root missing before the check");
    const box = document.createElement("div");
    box.id = "hit-target-selfcheck";
    box.innerHTML = `
      <div style="position:fixed;top:10px;left:10px;width:300px">
        <div style="display:flex;gap:8px"><span style="pointer-events:none">fires-dead-title</span><button type="button">go</button></div>
        <div style="display:flex;gap:8px"><button type="button"><span>quiet-in-button</span></button></div>
        <div style="display:flex;gap:8px"><label for="hit-quiet">quiet-label</label><input id="hit-quiet" /></div>
        <div style="display:flex;gap:8px"><span>quiet-no-control</span><span>other</span></div>
      </div>`;
    host.appendChild(box);
  });
  const found = await findDeadTextTargets(page);
  await page.evaluate(() =>
    document.getElementById("hit-target-selfcheck")?.remove(),
  );
  if (!found.some((f) => f.includes("fires-dead-title"))) {
    throw new Error(
      "The hit-target check is BLIND: a title beside a button that no press can reach was not reported, so a clean run proves nothing about what a mouse can press.\n" +
        `What it did report: ${found.length === 0 ? "nothing" : found.join("; ")}`,
    );
  }
  const misfired = found.filter((f) => f.includes("quiet-"));
  if (misfired.length > 0) {
    throw new Error(
      "The hit-target check reported text a press reaches:\n  " +
        misfired.join("\n  "),
    );
  }
}

/** A control's place in the tile, relative to the tile's own corner. */
export interface ControlPlace {
  key: string;
  x: number;
  y: number;
}

/** Pixels a control may move between two states before it counts as having moved. */
const CONTROL_MOVE_TOLERANCE_PX = 1.5;

/**
 * Where every visible control sits, keyed by what it is called, so a control
 * can be found again after a state change. Two controls with one name are told
 * apart by their order.
 */
export async function measureControls(page: Page): Promise<ControlPlace[]> {
  return page.evaluate(
    ([controlSelector]) => {
      const host = document.getElementById("root");
      if (!host) return [] as { key: string; x: number; y: number }[];
      const origin = host.getBoundingClientRect();
      const counts: Record<string, number> = {};
      const out: { key: string; x: number; y: number }[] = [];
      for (const el of Array.from(host.querySelectorAll(controlSelector))) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const s = getComputedStyle(el);
        if (s.visibility === "hidden" || s.display === "none") continue;
        const name = (el.getAttribute("aria-label") ?? el.textContent ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 40);
        const base = `${el.tagName.toLowerCase()} "${name}"`;
        counts[base] = (counts[base] ?? 0) + 1;
        out.push({
          key: `${base} #${counts[base]}`,
          x: r.left - origin.left,
          y: r.top - origin.top,
        });
      }
      return out;
    },
    [CONTROL_SELECTOR] as const,
  );
}

/**
 * The controls present in both states that moved by themselves. A scroll or a
 * resize moves nearly everything by the same amount, which is not one control
 * being pushed by another, so a move shared by most of the controls is dropped.
 */
export function shiftedControls(
  before: readonly ControlPlace[],
  after: readonly ControlPlace[],
): string[] {
  const later = new Map(after.map((c) => [c.key, c]));
  const moved: { key: string; dx: number; dy: number }[] = [];
  let shared = 0;
  for (const c of before) {
    const n = later.get(c.key);
    if (!n) continue;
    shared++;
    const dx = n.x - c.x;
    const dy = n.y - c.y;
    if (
      Math.abs(dx) > CONTROL_MOVE_TOLERANCE_PX ||
      Math.abs(dy) > CONTROL_MOVE_TOLERANCE_PX
    ) {
      moved.push({ key: c.key, dx, dy });
    }
  }
  if (shared > 2 && moved.length / shared >= 0.9) {
    const first = moved[0];
    if (
      moved.every(
        (m) =>
          Math.abs(m.dx - first.dx) <= CONTROL_MOVE_TOLERANCE_PX &&
          Math.abs(m.dy - first.dy) <= CONTROL_MOVE_TOLERANCE_PX,
      )
    ) {
      return [];
    }
  }
  return moved.map(
    (m) => `${m.key} moved ${m.dx.toFixed(1)}, ${m.dy.toFixed(1)}px`,
  );
}

/** Lets a state change reach the DOM and the layout that follows it settle. */
async function awaitSettled(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((res) => {
        requestAnimationFrame(() => requestAnimationFrame(() => res()));
      }),
  );
  await page.waitForTimeout(150);
}

/**
 * Fires each action the mounted widget declares, one after another as an input
 * bound to it would, and reports every control that moved when it did.
 *
 * A control that moves under an operator's pointer when another control is
 * pressed gets pressed in its new place. A static render holds one state, so
 * it cannot see this. The widget is left in the state the last action made, so
 * this runs after every other measurement and never on a render that is saved.
 */
export async function findActionShifts(
  page: Page,
  widgetId: string,
): Promise<string[]> {
  const actions = await page.evaluate(
    (id) => window.__probeActions?.(id) ?? [],
    widgetId,
  );
  const out: string[] = [];
  for (const action of actions) {
    const before = await measureControls(page);
    await page.evaluate(
      (a) => window.__dispatchProbeAction?.(a.id, a.kind),
      action,
    );
    await awaitSettled(page);
    const after = await measureControls(page);
    for (const shift of shiftedControls(before, after)) {
      out.push(`after action "${action.id}": ${shift}`);
    }
    // The control bound to the action is pressed the way a mouse presses it, since an input and a click reach a widget by different paths.
    const centre = await page.evaluate(
      ([label, controlSelector]) => {
        const host = document.getElementById("root");
        if (!host) return null;
        // The control an action is bound to is not declared, so it is the one whose name shares the most words with the action's label.
        const ignore = [
          "toggle",
          "set",
          "next",
          "the",
          "and",
          "available",
          "highlighted",
        ];
        const words = label
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length >= 3 && !ignore.includes(w));
        let best: Element | null = null;
        let bestScore = 0;
        for (const el of Array.from(host.querySelectorAll(controlSelector))) {
          const name = (el.getAttribute("aria-label") ?? el.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          if ((el as HTMLButtonElement).disabled) continue;
          const score = words.filter((w) => name.includes(w)).length;
          if (score > bestScore) {
            best = el;
            bestScore = score;
          }
        }
        if (best) {
          const r = best.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        return null;
      },
      [action.label, CONTROL_SELECTOR] as const,
    );
    if (!centre) continue;
    const beforeClick = await measureControls(page);
    await page.mouse.click(centre.x, centre.y);
    // Left where it clicked, the pointer would hover whatever the next render draws there.
    await page.mouse.move(-10, -10);
    await awaitSettled(page);
    const afterClick = await measureControls(page);
    for (const shift of shiftedControls(beforeClick, afterClick)) {
      out.push(`after pressing "${action.label}": ${shift}`);
    }
  }
  return out;
}

/**
 * Plants a state change that pushes a button down, which must be reported, and
 * one that adds a line below it and one that moves everything together, which
 * must not.
 */
export async function proveActionShiftCheckWorks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = document.getElementById("root");
    if (!host) throw new Error("Probe: #root missing before the check");
    const box = document.createElement("div");
    box.id = "action-shift-selfcheck";
    box.innerHTML = `
      <div id="shift-fires" style="position:absolute;top:10px;left:10px;width:200px"><div id="shift-fires-slot"></div><button type="button">fires-turn</button></div>
      <div id="shift-quiet" style="position:absolute;top:110px;left:10px;width:200px"><button type="button">quiet-turn</button><div id="shift-quiet-slot"></div></div>`;
    host.appendChild(box);
  });
  const before = await measureControls(page);
  await page.evaluate(() => {
    for (const id of ["shift-fires-slot", "shift-quiet-slot"]) {
      const line = document.createElement("div");
      line.style.height = "20px";
      line.textContent = "added";
      document.getElementById(id)?.appendChild(line);
    }
  });
  const after = await measureControls(page);
  await page.evaluate(() =>
    document.getElementById("action-shift-selfcheck")?.remove(),
  );
  const found = shiftedControls(before, after);
  if (!found.some((f) => f.includes("fires-turn"))) {
    throw new Error(
      "The action-shift check is BLIND: a button pushed down by a line added above it was not reported, so a clean run proves nothing about controls moving.\n" +
        `What it did report: ${found.length === 0 ? "nothing" : found.join("; ")}`,
    );
  }
  const misfired = found.filter((f) => f.includes("quiet-turn"));
  if (misfired.length > 0) {
    throw new Error(
      "The action-shift check reported a control that did not move:\n  " +
        misfired.join("\n  "),
    );
  }
}
