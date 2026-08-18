import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "../testing-react";
import type { CommandDelayHandle } from "./CommandDelay";
import {
  createDelayRailStore,
  DelayRailContext,
  useActiveHandles,
} from "./DelayRailContext";
import { usePanelDelay } from "./usePanelDelay";

function handle(effectiveDelaySeconds = 5): CommandDelayHandle {
  return { inFlight: [], shape: "discrete", effectiveDelaySeconds };
}

/** A command widget's usage: it holds a handle (from `useCommand` in real
 * code, a structural literal here) and contributes it with `usePanelDelay`,
 * exactly as `Badge` contributes with `useStatusContribution`. */
function Reporter({ h }: { h: CommandDelayHandle | null }) {
  usePanelDelay(h);
  return null;
}

function Probe() {
  const active = useActiveHandles();
  return (
    <output data-testid="active">
      {active.length === 0
        ? "none"
        : active
            .map((a) => a.effectiveDelaySeconds)
            .sort((x, y) => x - y)
            .join(",")}
    </output>
  );
}

function withStore(children: ReactNode, store = createDelayRailStore()) {
  return (
    <DelayRailContext.Provider value={store}>
      {children}
    </DelayRailContext.Provider>
  );
}

describe("usePanelDelay", () => {
  it("registers the handle into the nearest delay store on mount", () => {
    render(
      withStore(
        <>
          <Reporter h={handle(5)} />
          <Probe />
        </>,
      ),
    );
    expect(screen.getByTestId("active")).toHaveTextContent("5");
  });

  it("registers each command hook as its own active handle", () => {
    render(
      withStore(
        <>
          <Reporter h={handle(5)} />
          <Reporter h={handle(9)} />
          <Probe />
        </>,
      ),
    );
    expect(screen.getByTestId("active")).toHaveTextContent("5,9");
  });

  it("drops the handle when the hook unmounts", () => {
    const store = createDelayRailStore();
    const { rerender } = render(
      withStore(
        <>
          <Reporter h={handle(5)} />
          <Probe />
        </>,
        store,
      ),
    );
    expect(screen.getByTestId("active")).toHaveTextContent("5");
    rerender(withStore(<Probe />, store));
    expect(screen.getByTestId("active")).toHaveTextContent("none");
  });

  it("updates the registered handle in place when its value changes", () => {
    const store = createDelayRailStore();
    const { rerender } = render(
      withStore(
        <>
          <Reporter h={handle(5)} />
          <Probe />
        </>,
        store,
      ),
    );
    expect(screen.getByTestId("active")).toHaveTextContent("5");
    rerender(
      withStore(
        <>
          <Reporter h={handle(8)} />
          <Probe />
        </>,
        store,
      ),
    );
    expect(screen.getByTestId("active")).toHaveTextContent("8");
  });

  it("contributes nothing for a null handle", () => {
    render(
      withStore(
        <>
          <Reporter h={null} />
          <Probe />
        </>,
      ),
    );
    expect(screen.getByTestId("active")).toHaveTextContent("none");
  });

  it("is a no-op with no store in the tree: nothing active, no throw", () => {
    render(
      <>
        <Reporter h={handle(5)} />
        <Probe />
      </>,
    );
    expect(screen.getByTestId("active")).toHaveTextContent("none");
  });
});
