import { fireEvent, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { ExpandableText } from "./ExpandableText";

/**
 * A real RP-1 strategy description, at the length that prompted this
 * primitive: the Administration Building's Programs screen rendered one of
 * these under every card it drew.
 */
const LONG =
  'Soviet OKBs (OKB translates roughly to "Experimental Design Bureau") were ' +
  "state-run institutions that would design and prototype things for military " +
  "and space applications. Officially, they were numbered rather than named, " +
  "and the number outlived every chief designer who ran one. OKB-1 was " +
  "Korolev's, and it built the launch vehicle that put the first satellite " +
  "and the first human into orbit.";

describe("ExpandableText", () => {
  it("renders short prose whole, with no control at all", () => {
    render(<ExpandableText limit={160}>Reach the Karman line.</ExpandableText>);

    expect(screen.getByText("Reach the Karman line.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("truncates long prose and reveals the rest on press", () => {
    render(
      <ExpandableText limit={160} subject="Description">
        {LONG}
      </ExpandableText>,
    );

    expect(screen.queryByText(LONG)).toBeNull();
    const trigger = screen.getByRole("button", {
      name: "Show more of Description",
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);

    // Verbatim: the whole authored string, character for character.
    expect(screen.getByText(LONG)).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: "Show less of Description" }),
    ).toBe(trigger);
  });

  it("collapses again on a second press", () => {
    render(<ExpandableText limit={160}>{LONG}</ExpandableText>);

    const trigger = screen.getByRole("button", { name: "Show more" });
    fireEvent.click(trigger);
    fireEvent.click(trigger);

    expect(screen.queryByText(LONG)).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("cuts at a word boundary and never rewrites what it keeps", () => {
    render(<ExpandableText limit={40}>{LONG}</ExpandableText>);

    const shown = screen.getByText(/^Soviet OKBs/).textContent ?? "";
    const kept = shown.replace(/\.\.\.$/, "");
    // A prefix of the authored string, ending on a whole word: truncation is
    // a cut, never a paraphrase.
    expect(LONG.startsWith(kept)).toBe(true);
    expect(kept).not.toMatch(/\s$/);
    expect(LONG[kept.length]).toBe(" ");
    expect(shown.endsWith("...")).toBe(true);
  });

  it("does not hide a handful of characters behind a control", () => {
    // Just over the limit: the control would cost more room than the tail it
    // reveals, so there is no control and no cut.
    const text = `${"word ".repeat(6)}tail`;
    render(<ExpandableText limit={text.length - 4}>{text}</ExpandableText>);

    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("cuts hard when the text carries no word boundary to cut on", () => {
    const runOn = "x".repeat(400);
    render(<ExpandableText limit={40}>{runOn}</ExpandableText>);

    expect(screen.getByText(`${"x".repeat(40)}...`)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show more" }),
    ).toBeInTheDocument();
  });

  it("points the control at the prose it expands", () => {
    render(<ExpandableText limit={160}>{LONG}</ExpandableText>);

    const trigger = screen.getByRole("button", { name: "Show more" });
    const controlled = trigger.getAttribute("aria-controls");
    expect(controlled).toBeTruthy();
    expect(document.getElementById(controlled ?? "")).toHaveTextContent(
      /^Soviet OKBs/,
    );
  });

  it("has no accessibility violations, collapsed or expanded", async () => {
    const { container } = render(
      <ExpandableText limit={160} subject="Objectives">
        {LONG}
      </ExpandableText>,
    );
    await expectNoA11yViolations(container);

    fireEvent.click(screen.getByRole("button"));
    await expectNoA11yViolations(container);
  });
});
