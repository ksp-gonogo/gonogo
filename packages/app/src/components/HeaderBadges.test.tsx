import { clearContributions, registerContribution } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import {
  createDomainAvailabilityStore,
  DomainAvailabilityContext,
} from "@ksp-gonogo/ui-kit";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { HeaderBadges } from "./HeaderBadges";

/**
 * The header's contribution slot, driven by a stand-in contributor that reads a
 * Topic of its own the way any Uplink client would: nothing here knows what a
 * badge means, only that a contributed entry reaches the strip, that a held one
 * reads as held, and that one gated on a Domain waits for it.
 */
function mount() {
  const fixture = setupStreamFixture({ suspendFrames: true });
  const availability = createDomainAvailabilityStore();
  const view = render(
    <DomainAvailabilityContext.Provider value={availability}>
      <fixture.Provider>
        <HeaderBadges />
      </fixture.Provider>
    </DomainAvailabilityContext.Provider>,
  );
  const scene = (name: string) =>
    act(() => {
      fixture.emit("spaceCenter.scene", { scene: name });
    });
  return { ...view, availability, scene };
}

function contributeBadge(requires?: string) {
  registerContribution({
    id: "stub.header",
    contributes: "app.header-badges",
    requires,
    deps: ["spaceCenter.scene"] as const,
    compute: ({ "spaceCenter.scene": scene }) =>
      scene?.scene === "Flight"
        ? [{ id: "a", label: "BADGE A", tone: "caution" as const }]
        : [],
  });
}

// Before, not after: clearing notifies every mounted aggregator, and the previous case's tree is already unmounted here.
beforeEach(() => {
  clearContributions();
});

describe("HeaderBadges", () => {
  it("draws nothing while nothing is contributed", () => {
    const { container } = mount();

    expect(container).toBeEmptyDOMElement();
  });

  it("draws a contributed badge once its contributor's Topic says so, and announces it", async () => {
    contributeBadge();
    const { container, scene } = mount();

    scene("SpaceCenter");
    expect(screen.queryByText("BADGE A")).toBeNull();

    scene("Flight");
    expect(await screen.findByText("BADGE A")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("BADGE A");
    await expectNoA11yViolations(container);

    scene("SpaceCenter");
    expect(screen.queryByText("BADGE A")).toBeNull();
  });

  it("reads a held badge through the kit's held word, keeping its verdict in the tooltip", async () => {
    registerContribution({
      id: "stub.held",
      contributes: "app.header-badges",
      compute: () => [
        {
          id: "b",
          label: "BADGE B",
          tone: "go" as const,
          held: "held" as const,
        },
      ],
    });
    mount();

    const badge = await screen.findByText("HELD");
    expect(screen.queryByText("BADGE B")).toBeNull();
    expect(badge.closest("[title]")).toHaveAttribute("title", "BADGE B: HELD");
  });

  it("holds back a contribution gated on a Domain until that Domain is present", async () => {
    contributeBadge("stub-domain");
    const { availability, scene } = mount();

    scene("Flight");
    expect(screen.queryByText("BADGE A")).toBeNull();

    act(() => availability.setAvailable("stub-domain", true));
    expect(await screen.findByText("BADGE A")).toBeInTheDocument();

    act(() => availability.setAvailable("stub-domain", false));
    expect(screen.queryByText("BADGE A")).toBeNull();
  });
});
