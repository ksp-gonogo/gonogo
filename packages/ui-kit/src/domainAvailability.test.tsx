import { describe, expect, it, vi } from "vitest";
import {
  createDomainAvailabilityStore,
  DomainAvailabilityContext,
  useDomainAvailable,
} from "./domainAvailability";
import { act, render, screen } from "./testing-react";

describe("createDomainAvailabilityStore", () => {
  it("defaults an unknown Domain to unavailable and reflects set values", () => {
    const store = createDomainAvailabilityStore();
    expect(store.isAvailable("demomod")).toBe(false);

    store.setAvailable("demomod", true);
    expect(store.isAvailable("demomod")).toBe(true);

    store.setAvailable("demomod", false);
    expect(store.isAvailable("demomod")).toBe(false);
  });

  it("notifies subscribers only on a real change", () => {
    const store = createDomainAvailabilityStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.setAvailable("powermod", true);
    expect(listener).toHaveBeenCalledTimes(1);

    // Same value again → no-op, no notify.
    store.setAvailable("powermod", true);
    expect(listener).toHaveBeenCalledTimes(1);

    store.setAvailable("powermod", false);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    store.setAvailable("powermod", true);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("useDomainAvailable", () => {
  function Probe({ domain }: { domain: string | undefined }) {
    const available = useDomainAvailable(domain);
    return <div data-testid="probe">available={String(available)}</div>;
  }

  it("is false with no provider in the tree", () => {
    render(<Probe domain="demomod" />);
    expect(screen.getByTestId("probe").textContent).toBe("available=false");
  });

  it("is false for an undefined Domain even with a provider", () => {
    const store = createDomainAvailabilityStore();
    store.setAvailable("demomod", true);
    render(
      <DomainAvailabilityContext.Provider value={store}>
        <Probe domain={undefined} />
      </DomainAvailabilityContext.Provider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("available=false");
  });

  it("tracks the store, re-rendering when its Domain flips", () => {
    const store = createDomainAvailabilityStore();
    render(
      <DomainAvailabilityContext.Provider value={store}>
        <Probe domain="demomod" />
      </DomainAvailabilityContext.Provider>,
    );

    expect(screen.getByTestId("probe").textContent).toBe("available=false");

    act(() => store.setAvailable("demomod", true));
    expect(screen.getByTestId("probe").textContent).toBe("available=true");

    act(() => store.setAvailable("demomod", false));
    expect(screen.getByTestId("probe").textContent).toBe("available=false");
  });
});
