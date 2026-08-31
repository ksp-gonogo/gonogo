import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Row, RowName } from "./Row";

describe("Row", () => {
  it("renders as an li by default", () => {
    render(
      <ul>
        <Row>
          <RowName>Thermometer</RowName>
        </Row>
      </ul>,
    );
    expect(screen.getByRole("listitem")).toHaveTextContent("Thermometer");
  });

  it("renders as a different tag via the as prop", () => {
    render(
      <Row as="div" data-testid="row">
        <RowName>Barometer</RowName>
      </Row>,
    );
    expect(screen.getByTestId("row").tagName).toBe("DIV");
  });

  /**
   * The subordinate row, asserted as an ASYMMETRY against an ordinary one.
   *
   * <para>Left-only is the whole reason the prop exists: the obvious indent is a
   * padded wrapper, ui-kit's `Box` pads both sides, and the waste on the right
   * costs the name exactly the width it needs. A row indented on both sides is a
   * squeeze wearing an indent's clothes.</para>
   *
   * <para>Compared against a plain row rather than against a literal, because
   * jsdom does not resolve custom properties and an assertion on the token's
   * VALUE would be testing how the test environment renders `var()` rather than
   * what the prop does. The relationship is the claim: left differs, right does
   * not.</para>
   */
  it("insets a nested row on the left and nowhere else", () => {
    render(
      <div>
        <Row as="div" data-testid="plain">
          <RowName>Vehicle</RowName>
        </Row>
        <Row as="div" nested data-testid="nested">
          <RowName>Untooled</RowName>
        </Row>
      </div>,
    );

    const plain = getComputedStyle(screen.getByTestId("plain"));
    const nested = getComputedStyle(screen.getByTestId("nested"));

    expect(nested.paddingLeft).not.toBe(plain.paddingLeft);
    expect(nested.paddingRight).toBe(plain.paddingRight);
  });

  it("exposes RowName as Row.Name", () => {
    expect(Row.Name).toBe(RowName);
  });

  it("keeps to one line by default", () => {
    render(
      <Row data-testid="row">
        <RowName>Barometer</RowName>
      </Row>,
    );
    expect(getComputedStyle(screen.getByTestId("row")).flexWrap).not.toBe(
      "wrap",
    );
  });

  /**
   * Both halves of `wrap`, because either alone leaves the row exactly as
   * broken as it was: without the floor the name yields all its width and the
   * line never overflows, so `flex-wrap` never fires.
   */
  it("wraps and floors the name width when asked", () => {
    render(
      <Row wrap data-testid="row">
        <RowName data-testid="name">Mystery Goo™ Containment Unit</RowName>
      </Row>,
    );
    expect(getComputedStyle(screen.getByTestId("row")).flexWrap).toBe("wrap");
    expect(getComputedStyle(screen.getByTestId("name")).minWidth).toBe(
      "min(12ch, 100%)",
    );
  });
});
