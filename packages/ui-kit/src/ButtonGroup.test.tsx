import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";
import { ButtonGroup } from "./ButtonGroup";

describe("ButtonGroup", () => {
  it("renders its buttons", () => {
    render(
      <ButtonGroup aria-label="Actions" role="group">
        <Button>Accept</Button>
        <Button>Decline</Button>
      </ButtonGroup>,
    );
    expect(screen.getByRole("group", { name: "Actions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
  });

  it("shares one width across its buttons by default, and lets them size to content when asked", () => {
    const { rerender } = render(
      <ButtonGroup data-testid="g">
        <Button>Go</Button>
      </ButtonGroup>,
    );
    expect(getComputedStyle(screen.getByTestId("g")).gridAutoColumns).toBe(
      "1fr",
    );
    rerender(
      <ButtonGroup data-testid="g" equalWidth={false}>
        <Button>Go</Button>
      </ButtonGroup>,
    );
    expect(getComputedStyle(screen.getByTestId("g")).gridAutoColumns).toBe(
      "auto",
    );
  });

  it("stretches its buttons to one height", () => {
    render(
      <ButtonGroup data-testid="g">
        <Button size="sm">a</Button>
        <Button size="md">b</Button>
      </ButtonGroup>,
    );
    expect(getComputedStyle(screen.getByTestId("g")).alignItems).toBe(
      "stretch",
    );
  });

  it("forwards a ref to its root div", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <ButtonGroup ref={ref} data-testid="g">
        <Button>a</Button>
      </ButtonGroup>,
    );
    expect(ref.current).toBe(screen.getByTestId("g"));
  });
});
