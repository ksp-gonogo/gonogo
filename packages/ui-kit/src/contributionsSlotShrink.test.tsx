import {
  clearContributions,
  registerContribution,
} from "@ksp-gonogo/sitrep-sdk/spine";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { useContributionsBySlotId } from "./contributionsRead";
import { ContributionsProvider } from "./contributionsRuntime";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface ContributionRegistry {
    "shrink-probe.rows": { entry: { label: string } };
  }
}

const SLOT = "shrink-probe.rows";

function Probe() {
  const entries = useContributionsBySlotId(SLOT);
  return <output data-testid="count">{entries.length}</output>;
}

// beforeEach, never afterEach: clearing while the previous tree is mounted notifies a subscriber outside act().
beforeEach(() => {
  clearContributions();
});

describe("a slot that leaves the provider's list", () => {
  it("stops serving the entries it computed", () => {
    registerContribution({
      id: "shrink-probe-a",
      contributes: SLOT,
      compute: () => [{ label: "a" }],
    });
    const tree = (slots: readonly string[]) => (
      <ContributionsProvider slots={slots}>
        <Probe />
      </ContributionsProvider>
    );
    const { rerender } = render(tree([SLOT]));
    expect(screen.getByTestId("count")).toHaveTextContent("1");

    rerender(tree([]));

    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });
});
