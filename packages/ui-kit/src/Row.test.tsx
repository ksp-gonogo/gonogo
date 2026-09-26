import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Row, RowName } from "./Row";
import { emittedRuleFor } from "./test/emittedRule";

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
   * The subordinate row, asserted as an asymmetry against an ordinary one
   * rather than a literal, since jsdom does not resolve custom properties.
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
   * Both halves of `wrap`: without the floor the name yields all its width and
   * `flex-wrap` never fires.
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

describe("Row as a control", () => {
  it("does not submit a form it sits in", async () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) =>
      e.preventDefault(),
    );
    render(
      <form onSubmit={onSubmit}>
        <Row as="button" interactive>
          <RowName>Mun</RowName>
        </Row>
      </form>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Mun" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps a nested row's indent when it is also interactive", () => {
    render(
      <Row as="button" interactive nested>
        <RowName>Minmus</RowName>
      </Row>,
    );
    const rule = emittedRuleFor(screen.getByRole("button", { name: "Minmus" }));
    expect(rule.lastIndexOf("padding-left")).toBeGreaterThan(
      rule.lastIndexOf("padding:"),
    );
  });
});
