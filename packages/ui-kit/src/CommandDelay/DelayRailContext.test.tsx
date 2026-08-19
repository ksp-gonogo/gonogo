import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  type CommandHandle,
  createDelayRailStore,
  DelayRailContext,
  useActiveHandles,
  useDelayRailStore,
} from "./DelayRailContext";

function makeHandle(id: string, effectiveDelaySeconds = 4): CommandHandle {
  return { id, inFlight: [], shape: "discrete", effectiveDelaySeconds };
}

// ── store mechanics (no React), same style as PanelStatusStore.test.ts ────

describe("createDelayRailStore", () => {
  it("is empty with no registrations", () => {
    const store = createDelayRailStore();
    expect(store.getActiveHandles()).toEqual([]);
  });

  it("register adds a handle, insertion-ordered", () => {
    const store = createDelayRailStore();
    store.register(makeHandle("a"));
    store.register(makeHandle("b"));
    expect(store.getActiveHandles().map((h) => h.id)).toEqual(["a", "b"]);
  });

  it("register replaces an existing entry for the same id in place", () => {
    const store = createDelayRailStore();
    store.register(makeHandle("a", 4));
    store.register(makeHandle("a", 8));
    const active = store.getActiveHandles();
    expect(active).toHaveLength(1);
    expect(active[0].effectiveDelaySeconds).toBe(8);
  });

  it("deregister drops the handle", () => {
    const store = createDelayRailStore();
    const drop = store.register(makeHandle("a"));
    store.register(makeHandle("b"));
    drop();
    expect(store.getActiveHandles().map((h) => h.id)).toEqual(["b"]);
  });

  it("getActiveHandles is referentially stable while the active set is unchanged", () => {
    const store = createDelayRailStore();
    store.register(makeHandle("a"));
    const first = store.getActiveHandles();
    const second = store.getActiveHandles();
    expect(second).toBe(first);
  });

  it("returns a fresh array only when the active set actually changes", () => {
    const store = createDelayRailStore();
    const first = store.getActiveHandles();
    store.register(makeHandle("a"));
    const next = store.getActiveHandles();
    expect(next).not.toBe(first);
  });

  it("notifies subscribers on register / deregister", () => {
    const store = createDelayRailStore();
    const onChange = vi.fn();
    const unsub = store.subscribe(onChange);
    const drop = store.register(makeHandle("a"));
    drop();
    expect(onChange).toHaveBeenCalledTimes(2);
    unsub();
    store.register(makeHandle("b"));
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

// ── context wiring (React mount/unmount), same style as statusHooks.test.tsx ──

/** A minimal fixture registrant: registers `handle` on mount, deregisters on
 * unmount, directly against the context (not via `useCommand`, which lives
 * in `@ksp-gonogo/sitrep-client` and is covered by that package's own
 * `use-command.test.tsx` integration test). */
function Registrant({ handle }: { handle: CommandHandle }) {
  const store = useDelayRailStore();
  useEffect(() => {
    if (!store) return;
    return store.register(handle);
  }, [store, handle]);
  return null;
}

function ActiveHandlesProbe() {
  const active = useActiveHandles();
  return (
    <output data-testid="active-ids">
      {active.length === 0 ? "none" : active.map((h) => h.id).join(",")}
    </output>
  );
}

function withStore(children: React.ReactNode) {
  const store = createDelayRailStore();
  return (
    <DelayRailContext.Provider value={store}>
      {children}
    </DelayRailContext.Provider>
  );
}

describe("DelayRailContext + useActiveHandles", () => {
  it("returns every registered handle", () => {
    render(
      withStore(
        <>
          <Registrant handle={makeHandle("a")} />
          <Registrant handle={makeHandle("b")} />
          <ActiveHandlesProbe />
        </>,
      ),
    );
    expect(screen.getByTestId("active-ids")).toHaveTextContent("a,b");
  });

  it("drops a handle once its registrant unmounts", () => {
    const store = createDelayRailStore();
    const { rerender } = render(
      <DelayRailContext.Provider value={store}>
        <Registrant handle={makeHandle("a")} />
        <Registrant handle={makeHandle("b")} />
        <ActiveHandlesProbe />
      </DelayRailContext.Provider>,
    );
    expect(screen.getByTestId("active-ids")).toHaveTextContent("a,b");

    rerender(
      <DelayRailContext.Provider value={store}>
        <Registrant handle={makeHandle("a")} />
        <ActiveHandlesProbe />
      </DelayRailContext.Provider>,
    );
    expect(screen.getByTestId("active-ids")).toHaveTextContent("a");
  });

  it("is a no-op with no provider in the tree: no throw, nothing active", () => {
    render(
      <>
        <Registrant handle={makeHandle("a")} />
        <ActiveHandlesProbe />
      </>,
    );
    expect(screen.getByTestId("active-ids")).toHaveTextContent("none");
  });
});
