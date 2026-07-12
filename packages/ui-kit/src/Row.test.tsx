import { render, screen } from "@testing-library/react";
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
});
