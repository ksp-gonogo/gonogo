import { render, screen } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { ContractRewards } from "./ContractCardParts";
import { parseContracts } from "./contracts";

describe("contract rewards that the wire did not carry", () => {
  const [bare] = parseContracts([{ id: "7", title: "Bare" }]) ?? [];

  it("parse as null, never as nothing paid", () => {
    expect(bare).toMatchObject({
      fundsAdvance: null,
      fundsCompletion: null,
      scienceCompletion: null,
      repCompletion: null,
    });
  });

  it("draw the no-data token, and a stated zero draws nothing", () => {
    const { container, rerender } = render(<ContractRewards contract={bare} />);
    expect(screen.getAllByText(NULL_DISPLAY)).toHaveLength(3);
    rerender(
      <ContractRewards
        contract={{
          ...bare,
          fundsCompletion: 0,
          scienceCompletion: 0,
          repCompletion: 0,
        }}
      />,
    );
    expect(container.textContent).toBe("");
  });
});
