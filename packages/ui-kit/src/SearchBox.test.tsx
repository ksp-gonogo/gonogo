import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "./expectNoA11yViolations";
import { SearchBox } from "./SearchBox";

function Held() {
  const [text, setText] = useState("");
  return <SearchBox aria-label="Search" value={text} onChange={setText} />;
}

describe("SearchBox", () => {
  it("offers the kit's clear control only while there is text, and clearing returns focus", async () => {
    const user = userEvent.setup();
    const { container } = render(<Held />);
    const field = screen.getByRole("searchbox", { name: "Search" });
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();

    await user.type(field, "fuel");
    await user.click(screen.getByRole("button", { name: "Clear search" }));

    expect(field).toHaveValue("");
    expect(field).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    await expectNoA11yViolations(container);
  });
});
