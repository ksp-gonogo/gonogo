import {
  clearContributions,
  registerContribution,
} from "@ksp-gonogo/sitrep-sdk/spine";
import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { useContributionsBySlotId } from "./contributionsRead";
import { ContributionsProvider } from "./contributionsRuntime";
import {
  createDomainAvailabilityStore,
  DomainAvailabilityContext,
} from "./domainAvailability";
import { WidgetMetaContext } from "./WidgetMetaContext";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface ContributionRegistry {
    "presence-probe.rows": { entry: { label: string } };
  }
}

const SLOT = "presence-probe.rows";

function Probe() {
  const entries = useContributionsBySlotId(SLOT);
  return <output data-testid="count">{entries.length}</output>;
}

function mount(store = createDomainAvailabilityStore()) {
  render(
    <DomainAvailabilityContext.Provider value={store}>
      <WidgetMetaContext.Provider
        value={{ componentId: "presence-probe", contributionSlots: [SLOT] }}
      >
        <ContributionsProvider>
          <Probe />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </DomainAvailabilityContext.Provider>,
  );
  return store;
}

afterEach(() => {
  clearContributions();
});

describe("a contribution's requires gate", () => {
  it("runs only while the host says its Domain is present, the same store an augment's gate reads", () => {
    registerContribution({
      id: "presence-probe-demomod",
      contributes: SLOT,
      requires: "demomod",
      compute: () => [{ label: "from demomod" }],
    });
    const store = mount();
    expect(screen.getByTestId("count")).toHaveTextContent("0");

    act(() => store.setAvailable("demomod", true));
    expect(screen.getByTestId("count")).toHaveTextContent("1");

    act(() => store.setAvailable("demomod", false));
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("gates nothing a contribution does not ask to be gated on", () => {
    registerContribution({
      id: "presence-probe-ungated",
      contributes: SLOT,
      compute: () => [{ label: "always" }],
    });
    mount();
    expect(screen.getByTestId("count")).toHaveTextContent("1");
  });
});
