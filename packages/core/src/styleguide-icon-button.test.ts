// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  type IconButtonRule,
  iconButtonHits,
  scanIconButtons,
} from "./icon-button-design.scan";
import { ratchetRepoRoot } from "./ratchetBaseRef";

/**
 * A glyph-only button is the kit's `IconButton`, drawn one way. Nothing wraps
 * it in `styled()`, hands it a `style`, `className` or `css` prop, or stands a
 * hand-styled button in for it. Layout (margin, alignment, position) goes on a
 * wrapper element around it.
 *
 * The planted violations are source strings run through the same parser as the
 * tree, so a scan that stopped seeing a rule fails here and never reads zero
 * because it is blind.
 */

const RESULT = scanIconButtons();

const rules = (source: string): IconButtonRule[] =>
  iconButtonHits(source).map((hit) => hit.rule);

describe("design-system: one icon button design", () => {
  it("reads the app, the packages and the bundled Uplinks", () => {
    console.info(
      `[icon-button] root ${ratchetRepoRoot()}, read ${RESULT.read.length} tracked source files`,
    );
    expect(RESULT.read.length).toBeGreaterThan(300);
    expect(RESULT.read.some((f) => f.startsWith("packages/ui-kit/"))).toBe(
      true,
    );
    expect(RESULT.read.some((f) => f.startsWith("packages/app/"))).toBe(true);
    expect(RESULT.read.some((f) => f.startsWith("mod/"))).toBe(true);
    expect(RESULT.read.some((f) => f.endsWith(".test.tsx"))).toBe(false);
  });

  it("finds no restyled, wrapped or hand-built icon button", () => {
    expect(
      RESULT.hits.map((h) => `${h.file}:${h.line} [${h.rule}] ${h.text}`),
    ).toEqual([]);
  });

  describe("sees each planted violation", () => {
    it("styled(IconButton)", () => {
      expect(rules(`const Close = styled(IconButton)\`color: red;\`;`)).toEqual(
        ["styled-icon-button"],
      );
    });

    it.each([
      "style",
      "className",
      "css",
    ])("a %s prop on IconButton", (prop) => {
      const source = `const A = () => <IconButton aria-label="x" ${prop}={{}}><X /></IconButton>;`;
      expect(rules(source)).toEqual(["icon-button-look-prop"]);
    });

    it("a styled.button holding an icon", () => {
      const source = `const Close = styled.button\`border: none;\`;
const A = () => <Close aria-label="x"><CloseIcon /></Close>;`;
      expect(rules(source)).toEqual(["glyph-only-button"]);
    });

    it("a styled(Button) holding an icon", () => {
      const source = `const Close = styled(Button)\`padding: 0;\`;
const A = () => <Close aria-label="x"><CloseIcon size={12} /></Close>;`;
      expect(rules(source)).toEqual(["glyph-only-button"]);
    });

    it("a raw button holding a mark", () => {
      expect(
        rules(`const A = () => <button aria-label="x">×</button>;`),
      ).toEqual(["glyph-only-button"]);
    });

    it("the kit's Button holding an icon", () => {
      expect(
        rules(`const A = () => <Button aria-label="x"><CloseIcon /></Button>;`),
      ).toEqual(["glyph-only-button"]);
    });

    it("a button whose mark depends on state", () => {
      const source = `const A = () => <button aria-label="x">{on ? "▶" : "❚❚"}</button>;`;
      expect(rules(source)).toEqual(["glyph-only-button"]);
    });
  });

  describe("leaves what is allowed", () => {
    it("a plain IconButton", () => {
      expect(
        rules(
          `const A = () => <IconButton aria-label="x" onClick={f}><CloseIcon /></IconButton>;`,
        ),
      ).toEqual([]);
    });

    it("an IconButton inside a wrapper that carries the layout", () => {
      expect(
        rules(
          `const A = () => <span style={{ position: "absolute" }}><IconButton aria-label="x"><CloseIcon /></IconButton></span>;`,
        ),
      ).toEqual([]);
    });

    it("a button with words, with or without an icon", () => {
      expect(
        rules(
          `const A = () => <Button><CloseIcon /> Close</Button>;
const B = () => <button>Save</button>;`,
        ),
      ).toEqual([]);
    });

    it("a button whose face is computed", () => {
      expect(rules(`const A = () => <button>{label}</button>;`)).toEqual([]);
    });
  });
});
