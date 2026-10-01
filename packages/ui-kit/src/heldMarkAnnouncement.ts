import { MODELLED_TO_SCET } from "./readingCurrency";
import { HELD_WORDS } from "./status/streamStatusWord";

/**
 * Why a drawn held mark fails to tell an operator what it means:
 * `silent` where nothing a screen reader hears names its grade, `no-hover`
 * where the hover does not, and `no-as-of` where the hover leaves out the
 * instant the spoken words give.
 *
 * @category Testing
 */
export type HeldMarkFault = "silent" | "no-hover" | "no-as-of";

/**
 * One held mark that does not announce itself, with a short description of
 * where it was drawn.
 *
 * @category Testing
 */
export interface UnannouncedHeldMark {
  mark: Element;
  fault: HeldMarkFault;
  where: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";

const GRADE_WORDS: readonly string[] = [...HELD_WORDS, MODELLED_TO_SCET];

function namesGrade(text: string | null | undefined): boolean {
  return text != null && GRADE_WORDS.some((word) => text.includes(word));
}

/**
 * What the mark says in words, to the ear and on hover.
 *
 * An HTML mark hangs off a host that holds the figure, and the host carries
 * the caption (`[data-unit-currency]`) and the hover (`[data-tooltip]`), on
 * itself or on the `<Unit>`s inside it. A mark in an SVG is a tspan, silent
 * by construction: the instrument says it at the end of the accessible name
 * of the nearest labelled ancestor, and its hover is that drawing's
 * `<title>` or the kit's tooltip on the instrument around it.
 */
function statementOf(mark: Element): { spoken: string; hover: string } {
  if (mark.namespaceURI === SVG_NS) {
    const labelled = mark.closest("[aria-label]");
    const svg = mark.closest("svg");
    const title = svg?.querySelector(":scope > title")?.textContent ?? "";
    const tip = mark.closest("[data-tooltip]")?.getAttribute("data-tooltip");
    return {
      spoken: labelled?.getAttribute("aria-label") ?? title,
      hover: [title, tip ?? ""].join(" "),
    };
  }
  const host = mark.parentElement;
  if (host === null) return { spoken: "", hover: "" };
  const captions = Array.from(
    host.querySelectorAll("[data-unit-currency]"),
    (el) => el.textContent ?? "",
  );
  const tips = [host, ...Array.from(host.querySelectorAll("[data-tooltip]"))]
    .map((el) => el.getAttribute("data-tooltip") ?? "")
    .filter((tip) => tip !== "");
  return { spoken: captions.join(" "), hover: tips.join(" ") };
}

function describe(mark: Element): string {
  const host =
    mark.namespaceURI === SVG_NS
      ? (mark.closest("svg")?.getAttribute("aria-label") ?? "svg")
      : (mark.parentElement?.textContent ?? "").trim();
  return host.length > 60 ? `${host.slice(0, 57)}...` : host;
}

/**
 * Every held mark (`[data-held-mark]`) under `root` that does not say what it
 * means: its grade's word to a screen reader and on hover, with the hover
 * naming the same "as of" instant the spoken words do.
 *
 * Keyed on the mark rather than the figure, so a dot drawn by hand outside any
 * kit primitive is still asked about.
 *
 * @category Testing
 */
export function unannouncedHeldMarks(
  root: ParentNode = document.body,
): UnannouncedHeldMark[] {
  return Array.from(root.querySelectorAll("[data-held-mark]")).flatMap(
    (mark) => {
      const fault = faultOf(statementOf(mark));
      return fault === null ? [] : [{ mark, fault, where: describe(mark) }];
    },
  );
}

function faultOf({
  spoken,
  hover,
}: {
  spoken: string;
  hover: string;
}): HeldMarkFault | null {
  if (!namesGrade(spoken)) return "silent";
  if (!namesGrade(hover)) return "no-hover";
  if (spoken.includes("as of") && !hover.includes("as of")) return "no-as-of";
  return null;
}
