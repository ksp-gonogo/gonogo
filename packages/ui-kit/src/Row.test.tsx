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
