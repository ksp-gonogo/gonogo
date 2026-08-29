// @vitest-environment jsdom

import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, render } from "../testing";
import {
  clearRootProviders,
  RootProviders,
  registerRootProvider,
} from "./root-providers";

const Marker = createContext<string | null>(null);

function Readout() {
  return <div>value: {useContext(Marker) ?? "none"}</div>;
}

function providerFor(value: string) {
  return function Provider({
    screen: s,
    children,
  }: {
    screen: string;
    children: ReactNode;
  }) {
    return (
      <Marker.Provider value={`${value}@${s}`}>{children}</Marker.Provider>
    );
  };
}

afterEach(() => {
  /*
   * Wrapped, because clearing publishes to the store and the tree is still
   * mounted at this point: React Testing Library's own cleanup is registered
   * in the shared setup and runs after this hook, so the subscribers are live
   * and re-render outside act unless the clear is held inside one.
   *
   * The clear itself is load-bearing and cannot simply be dropped. This
   * registry lives on a globalThis slot deliberately, so that two builds of
   * the package find the same state, and vitest's per-file isolation resets
   * MODULES rather than globals: a registration left behind here is still
   * there for the next file the worker runs.
   */
  act(() => {
    clearRootProviders();
  });
});

describe("root providers", () => {
  it("mounts a provider registered before the screen renders", () => {
    registerRootProvider({ id: "a", Provider: providerFor("a") });
    const { container } = render(
      <RootProviders screen="main">
        <Readout />
      </RootProviders>,
    );
    expect(container.textContent).toBe("value: a@main");
  });

  /*
   * The case the whole subscription exists for. An Uplink's client bundle is
   * fetched at runtime, so it registers AFTER the screen has mounted. Read the
   * registry once and this renders "none" forever, with no error to say so.
   */
  it("mounts a provider that registers after the screen has mounted", () => {
    const { container } = render(
      <RootProviders screen="main">
        <Readout />
      </RootProviders>,
    );
    expect(container.textContent).toBe("value: none");

    act(() => {
      registerRootProvider({ id: "late", Provider: providerFor("late") });
    });

    expect(container.textContent).toBe("value: late@main");
  });

  it("passes each screen its own id, so per-screen state cannot be shared", () => {
    registerRootProvider({ id: "a", Provider: providerFor("a") });
    const { container } = render(
      <RootProviders screen="station">
        <Readout />
      </RootProviders>,
    );
    expect(container.textContent).toBe("value: a@station");
  });

  it("nests in registration order, outermost first", () => {
    const seen: string[] = [];
    const recorder = (id: string) =>
      function Provider({ children }: { children: ReactNode }) {
        seen.push(id);
        return <>{children}</>;
      };
    registerRootProvider({ id: "outer", Provider: recorder("outer") });
    registerRootProvider({ id: "inner", Provider: recorder("inner") });
    render(
      <RootProviders screen="main">
        <Readout />
      </RootProviders>,
    );
    expect(seen).toEqual(["outer", "inner"]);
  });
});
