import type { Page } from "playwright";
import { probePayload } from "./probe/payload";
import { PLANTED_FACE_IDS } from "./probe/plantedFaceWidgets.ids";

/**
 * Whether a change of face on a control moves anything else in its widget.
 *
 * Each control is pressed on a fresh mount and the box of every other element
 * is compared before and after each face the press brings up. A command control
 * is taken through the faces its stub can answer with: rest, armed, sent, and
 * then, on separate mounts, refused and no reply. A control that sends nothing
 * is pressed up to three times, which covers both states of a toggle and the
 * open and closed states of an editor toggle.
 */

/** Smallest change of position or size, in pixels, that counts as a move. */
const MOVE_TOLERANCE_PX = 0.5;

/** Most presses on one control: arm, send, and one more for a toggle's second state. */
const MAX_PRESSES = 3;

/** Controls of one look kept per scene, so a list of identical rows is pressed a few times and not a hundred. */
const PER_SIGNATURE = 2;

/** Controls pressed per scene at most. */
const MAX_CONTROLS = 30;

/** Time for a press to reach the DOM and the layout that follows it to settle. */
const SETTLE_MS = 200;

/** Longer than the kit's "SENT" flash, so a face read after it is the one the control keeps. */
const PAST_FLASH_MS = 800;

export interface ControlRef {
  /** Position among the pressable controls of the scene, in document order. */
  index: number;
  /** What the control reads as: its tag and accessible name. */
  desc: string;
}

export interface FaceMove {
  /** The element that moved, as an operator would find it. */
  element: string;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

declare global {
  interface Window {
    __face: {
      list(): { index: number; desc: string; signature: string }[];
      mark(index: number): boolean;
      click(): void;
      diff(allowBelow: boolean): { moves: FaceMove[]; total: number };
    };
    /** Drives the mounted scene's command stub: how the next commands are answered, and how many were sent. */
    __probeStub: {
      hold: () => void;
      answerHeld: () => void;
      refuse: () => void;
      lose: () => void;
      sent: () => number;
    };
  }
}

/**
 * Page-side half, installed as a string so no transpiler helper is wrapped
 * around its inner functions. `list` names the pressable controls, `mark`
 * records the box of every element at rest and picks the control, `click`
 * presses it (finding it again by position when a face replaced the node), and
 * `diff` reports elements outside the control that are not where they were.
 */
const PAGE_SCRIPT = `(() => {
  const PRESSABLE = [
    "button", "summary", '[role="button"]', '[role="switch"]', '[role="tab"]',
    '[role="checkbox"]', '[role="menuitem"]', '[role="option"]',
    'input[type="checkbox"]', 'input[type="radio"]',
  ].join(",");
  const state = { els: [], rects: [], ids: new WeakMap(), control: null, index: -1 };

  const nameOf = (el) =>
    (el.getAttribute("aria-label") || el.textContent || "")
      .replace(/\\s+/g, " ").trim().slice(0, 40);

  const pressables = () => {
    const root = document.getElementById("root");
    if (!root) return [];
    const out = [];
    for (const el of Array.from(root.querySelectorAll(PRESSABLE))) {
      if (el.disabled) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none") continue;
      out.push(el);
    }
    return out;
  };

  const rectOf = (el, origin) => {
    const r = el.getBoundingClientRect();
    return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
  };

  const describe = (el) => {
    const name = nameOf(el);
    const tag = el.tagName.toLowerCase();
    if (name) return tag + ' "' + name + '"';
    const hook = el.getAttribute("data-testid") || el.getAttribute("data-panel-body") !== null && "panel body" || "";
    const own = Array.from(el.classList).filter((c) => !c.startsWith("sc-"))[0] || "";
    return hook ? tag + " [" + hook + "]" : own ? tag + "." + own : tag;
  };

  window.__face = {
    list() {
      return pressables().map((el, index) => {
        const name = nameOf(el);
        return {
          index,
          desc: describe(el),
          signature: el.tagName + "|" + el.className + "|" + name.replace(/[0-9]+/g, "#"),
        };
      });
    },
    mark(index) {
      const root = document.getElementById("root");
      const control = pressables()[index];
      if (!root || !control) return false;
      const origin = root.getBoundingClientRect();
      state.els = [];
      state.rects = [];
      state.ids = new WeakMap();
      for (const el of Array.from(root.querySelectorAll("*"))) {
        // Shapes inside a drawing are the drawing's, which is one box.
        const svg = el.closest("svg");
        if (svg && svg !== el) continue;
        state.ids.set(el, state.els.length);
        state.els.push(el);
        state.rects.push(rectOf(el, origin));
      }
      state.control = control;
      state.index = index;
      return true;
    },
    click() {
      if (!state.control || !state.control.isConnected) {
        // A face that replaced the node leaves the old one to stand for the control; a node that is gone is not a reason to stop.
        state.control = pressables()[state.index] || state.control;
      }
      if (!state.control) return;
      // An SVG element has no click(), so the press is dispatched the way the browser would.
      if (typeof state.control.click === "function") state.control.click();
      else state.control.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    },
    diff(allowBelow) {
      const root = document.getElementById("root");
      const origin = root.getBoundingClientRect();
      const control = state.control;
      const restBox = state.rects[state.ids.get(control)];
      const found = [];
      for (let i = 0; i < state.els.length; i++) {
        const el = state.els[i];
        if (!el.isConnected) continue;
        // The pressed control's own box is the one thing allowed to change, and so is anything that contains it.
        if (el === control || control.contains(el) || el.contains(control)) continue;
        const was = state.rects[i];
        const now = rectOf(el, origin);
        if (was.w === 0 && was.h === 0 && now.w === 0 && now.h === 0) continue;
        const dx = now.x - was.x;
        const dy = now.y - was.y;
        const dw = now.w - was.w;
        const dh = now.h - was.h;
        if (Math.abs(dx) <= ${MOVE_TOLERANCE_PX} && Math.abs(dy) <= ${MOVE_TOLERANCE_PX} &&
            Math.abs(dw) <= ${MOVE_TOLERANCE_PX} && Math.abs(dh) <= ${MOVE_TOLERANCE_PX}) continue;
        // A panel the control opens makes room by moving what sits below it, straight down.
        if (allowBelow && restBox && was.y >= restBox.y + restBox.h - ${MOVE_TOLERANCE_PX} &&
            Math.abs(dx) <= ${MOVE_TOLERANCE_PX} && Math.abs(dw) <= ${MOVE_TOLERANCE_PX}) continue;
        found.push({ i, el, dx, dy, dw, dh });
      }
      // An element carried along by a parent that moved the same way is the parent's finding.
      const moved = new Set(found.map((f) => f.el));
      const primary = found.filter((f) => {
        const p = f.el.parentElement;
        if (!p || !moved.has(p)) return true;
        const q = found.find((g) => g.el === p);
        return Math.abs(q.dx - f.dx) > ${MOVE_TOLERANCE_PX} || Math.abs(q.dy - f.dy) > ${MOVE_TOLERANCE_PX} ||
          Math.abs(q.dw - f.dw) > ${MOVE_TOLERANCE_PX} || Math.abs(q.dh - f.dh) > ${MOVE_TOLERANCE_PX};
      });
      return {
        total: primary.length,
        moves: primary.slice(0, 3).map((f) => ({
          element: describe(f.el), dx: f.dx, dy: f.dy, dw: f.dw, dh: f.dh,
        })),
      };
    },
  };
})()`;

/** Installs the page-side half; safe to call again after a remount. */
export async function installFaceProbe(page: Page): Promise<void> {
  await page.evaluate(PAGE_SCRIPT);
}

async function settle(page: Page, ms = SETTLE_MS): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((res) => {
        requestAnimationFrame(() => requestAnimationFrame(() => res()));
      }),
  );
  await page.waitForTimeout(ms);
}

/** Which controls of the mounted scene are worth pressing: one look is pressed a couple of times, not once per row. */
export async function pickControls(page: Page): Promise<ControlRef[]> {
  const all = await page.evaluate(() => window.__face.list());
  const seen = new Map<string, number>();
  const out: ControlRef[] = [];
  for (const c of all) {
    const n = seen.get(c.signature) ?? 0;
    seen.set(c.signature, n + 1);
    if (n >= PER_SIGNATURE) continue;
    out.push({ index: c.index, desc: c.desc });
    if (out.length >= MAX_CONTROLS) break;
  }
  return out;
}

type Answer = "ok" | "refused" | "lost";

function describeMove(m: FaceMove): string {
  const parts: string[] = [];
  if (
    Math.abs(m.dx) > MOVE_TOLERANCE_PX ||
    Math.abs(m.dy) > MOVE_TOLERANCE_PX
  ) {
    parts.push(`moved ${m.dx.toFixed(1)}, ${m.dy.toFixed(1)}px`);
  }
  if (
    Math.abs(m.dw) > MOVE_TOLERANCE_PX ||
    Math.abs(m.dh) > MOVE_TOLERANCE_PX
  ) {
    parts.push(`resized ${m.dw.toFixed(1)}, ${m.dh.toFixed(1)}px`);
  }
  return `${m.element} ${parts.join(" and ")}`;
}

/**
 * Presses `control` on a fresh mount and reports each face that moved
 * something. Findings read `control <desc> face "<face>": <element> moved ...`.
 */
async function pressThrough(
  page: Page,
  control: ControlRef,
  answer: Answer,
  allowBelow: boolean,
  remount: () => Promise<void>,
): Promise<{ findings: string[]; sentCommand: boolean }> {
  await remount();
  await installFaceProbe(page);
  const findings: string[] = [];
  if (!(await page.evaluate((i) => window.__face.mark(i), control.index))) {
    return { findings, sentCommand: false };
  }
  if (answer === "refused")
    await page.evaluate(() => window.__probeStub.refuse());
  if (answer === "lost") await page.evaluate(() => window.__probeStub.lose());
  // Holding the reply keeps the control on its sent face long enough to measure it.
  if (answer === "ok") await page.evaluate(() => window.__probeStub.hold());

  const report = async (face: string) => {
    const { moves, total } = await page.evaluate(
      (a) => window.__face.diff(a),
      allowBelow,
    );
    for (const m of moves) {
      findings.push(
        `${control.desc} face "${face}": ${describeMove(m)}${total > moves.length ? ` (+${total - moves.length} more)` : ""}`,
      );
    }
  };

  let sentCommand = false;
  for (let press = 1; press <= MAX_PRESSES; press++) {
    await page.evaluate(() => window.__face.click());
    await page.mouse.move(-10, -10);
    await settle(page);
    sentCommand = (await page.evaluate(() => window.__probeStub.sent())) > 0;
    const face = sentCommand
      ? answer === "ok"
        ? "sent"
        : answer === "refused"
          ? "refused"
          : "no reply"
      : `press ${press}`;
    await report(face);
    if (sentCommand) break;
  }
  if (sentCommand && answer === "ok") {
    await page.evaluate(() => window.__probeStub.answerHeld());
    await settle(page, PAST_FLASH_MS);
    await report("answered");
  }
  return { findings, sentCommand };
}

/**
 * Takes every worthwhile control of the mounted scene through its faces and
 * returns what moved, as `control <desc> face "<face>": ...` lines.
 * `opensBelow` names controls (by accessible name) whose own panel may open
 * below them.
 */
export async function findFaceShifts(
  page: Page,
  remount: () => Promise<void>,
  opensBelow: readonly string[] = [],
): Promise<string[]> {
  await installFaceProbe(page);
  const controls = await pickControls(page);
  const out: string[] = [];
  for (const control of controls) {
    const allow = opensBelow.some((name) => control.desc.includes(`"${name}"`));
    const first = await pressThrough(page, control, "ok", allow, remount);
    out.push(...first.findings);
    if (!first.sentCommand) continue;
    for (const answer of ["refused", "lost"] as const) {
      const next = await pressThrough(page, control, answer, allow, remount);
      out.push(...next.findings);
    }
  }
  return out;
}

const PLANT_FIXTURE = { _stream: { pinnedUt: 10, emits: [] } };

/**
 * Presses planted widgets and requires the check to see what it exists to see:
 * a button that widens when sent, a neighbour a status line pushes down, and a
 * panel opening below its toggle (which must be reported unless the scene names
 * it). A fixed-width button that changes its word must come out clean, or the
 * check reports faces that were never there.
 */
export async function proveFaceCheckWorks(page: Page): Promise<void> {
  const run = async (
    widgetId: string,
    opensBelow: readonly string[] = [],
  ): Promise<string[]> => {
    const payload = probePayload({
      widgetId,
      fixture: PLANT_FIXTURE,
      size: { w: 8, h: 6 },
    });
    const mount = () =>
      page.evaluate((p) => window.__renderProbe?.(p), payload);
    await mount();
    return findFaceShifts(page, mount, opensBelow);
  };
  const widens = await run(PLANTED_FACE_IDS.widens);
  if (
    !widens.some((f) => f.includes('face "sent"') && f.includes("neighbour"))
  ) {
    throw new Error(
      "The face check is BLIND: a button that widens on SENT and pushes its neighbour along was not reported.\n" +
        `What it did report: ${widens.length === 0 ? "nothing" : widens.join("; ")}`,
    );
  }
  const shifts = await run(PLANTED_FACE_IDS.shifts);
  if (!shifts.some((f) => f.includes("neighbour") && f.includes("moved"))) {
    throw new Error(
      "The face check is BLIND: a neighbour pushed down by a status line was not reported.\n" +
        `What it did report: ${shifts.length === 0 ? "nothing" : shifts.join("; ")}`,
    );
  }
  const panel = await run(PLANTED_FACE_IDS.panel);
  if (!panel.some((f) => f.includes("neighbour"))) {
    throw new Error(
      "The face check is BLIND: a panel opening below its toggle moved a neighbour and was not reported.\n" +
        `What it did report: ${panel.length === 0 ? "nothing" : panel.join("; ")}`,
    );
  }
  const allowed = await run(PLANTED_FACE_IDS.panel, ["Details"]);
  const steady = await run(PLANTED_FACE_IDS.steady);
  const wrong = [...allowed, ...steady];
  if (wrong.length > 0) {
    throw new Error(
      "The face check reported something that did not move, or a panel the scene names as allowed:\n  " +
        wrong.join("\n  "),
    );
  }
}
