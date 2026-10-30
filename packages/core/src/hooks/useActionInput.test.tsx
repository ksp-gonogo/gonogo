import { act, render } from "@ksp-gonogo/test-utils";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearActionHandlers, dispatchAction } from "../actions/dispatcher";
import { DashboardItemContext } from "../contexts/DashboardItemContext";
import { PerfBudget } from "../perf/PerfBudget";
import type { ActionDefinition } from "../types";
import { useActionInput } from "./useActionInput";

const toggleActions = [
  { id: "toggle", label: "Toggle", accepts: ["button"] },
] as const satisfies readonly ActionDefinition[];

function Harness({
  instanceId,
  children,
}: {
  instanceId: string;
  children: ReactNode;
}) {
  return (
    <DashboardItemContext.Provider value={{ instanceId }}>
      {children}
    </DashboardItemContext.Provider>
  );
}

function ToggleConsumer({ onToggle }: { onToggle: () => unknown }) {
  useActionInput<typeof toggleActions>({
    toggle: () => onToggle(),
  });
  return null;
}

beforeEach(() => clearActionHandlers());

describe("useActionInput", () => {
  it("registers the handler for the context's instance id", () => {
    const onToggle = vi.fn().mockReturnValue({ fired: true });

    render(
      <Harness instanceId="widget-1">
        <ToggleConsumer onToggle={onToggle} />
      </Harness>,
    );

    const result = dispatchAction("widget-1", "toggle", {
      kind: "button",
      value: true,
    });

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ fired: true });
  });

  it("unregisters on unmount", () => {
    const onToggle = vi.fn();

    const { unmount } = render(
      <Harness instanceId="widget-1">
        <ToggleConsumer onToggle={onToggle} />
      </Harness>,
    );
    unmount();

    dispatchAction("widget-1", "toggle", { kind: "button", value: true });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("keys handlers by instance id so sibling widgets are isolated", () => {
    const onA = vi.fn();
    const onB = vi.fn();

    render(
      <>
        <Harness instanceId="widget-a">
          <ToggleConsumer onToggle={onA} />
        </Harness>
        <Harness instanceId="widget-b">
          <ToggleConsumer onToggle={onB} />
        </Harness>
      </>,
    );

    dispatchAction("widget-a", "toggle", { kind: "button", value: true });

    expect(onA).toHaveBeenCalledTimes(1);
    expect(onB).not.toHaveBeenCalled();
  });

  it("does NOT re-register handlers on parent re-render, even when the handlers object identity changes every render", () => {
    // Reset the budget so the assertion is sensitive to this test's calls.
    const budget = PerfBudget.getAll().find(
      (b) => b.name === "useActionInput re-registrations/sec",
    );
    expect(budget).toBeDefined();
    if (!budget) return;
    budget.reset();

    let triggerRender: (() => void) | null = null;
    let lastSeenSpyCallCount = 0;
    const onToggle = vi.fn().mockReturnValue({ ok: true });

    function Renderer() {
      const [tick, setTick] = useState(0);
      triggerRender = () => setTick((n) => n + 1);
      // Inline object literal: fresh identity every render.
      useActionInput<typeof toggleActions>({
        toggle: () => {
          lastSeenSpyCallCount = onToggle.mock.calls.length;
          return onToggle();
        },
      });
      return <div data-testid="tick">{tick}</div>;
    }

    render(
      <Harness instanceId="widget-1">
        <Renderer />
      </Harness>,
    );
    expect(budget.getExceedanceCount()).toBe(0);
    expect(budget.windowTotal()).toBe(0);

    // Force ten parent re-renders with fresh handler-object identities.
    for (let i = 0; i < 10; i++) {
      act(() => {
        triggerRender?.();
      });
    }
    // No registrations at all: the proxy stays put.
    expect(budget.windowTotal()).toBe(0);

    // The proxy still routes to the latest closure: dispatch fires the current handler, which sees the up-to-date spy.
    dispatchAction("widget-1", "toggle", { kind: "button", value: true });
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(lastSeenSpyCallCount).toBe(0);
  });

  it("throws when used outside a DashboardItemContext.Provider", () => {
    // React logs render errors via console.error, and jsdom re-dispatches the
    // caught error as an `error` event that the default handler writes to
    // stderr. Silence both for this intentionally-throwing test.
    const suppress = vi.spyOn(console, "error").mockImplementation(() => {});
    const swallow = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener("error", swallow);

    try {
      expect(() =>
        render(<ToggleConsumer onToggle={() => undefined} />),
      ).toThrow(/DashboardItemContext/);
    } finally {
      window.removeEventListener("error", swallow);
      suppress.mockRestore();
    }
  });
});

describe("useActionInput re-registration budget", () => {
  const budget = () => {
    const found = PerfBudget.getAll().find(
      (b) => b.name === "useActionInput re-registrations/sec",
    );
    if (!found) throw new Error("budget not registered");
    return found;
  };

  function Many({ n }: { n: number }) {
    const ids = Array.from({ length: n }, (_, i) => `w-${i}`);
    return (
      <>
        {ids.map((id) => (
          <Harness key={id} instanceId={id}>
            <ToggleConsumer onToggle={() => ({})} />
          </Harness>
        ))}
      </>
    );
  }

  it("stays silent when many widgets register at mount", () => {
    budget().reset();
    render(<Many n={200} />);
    expect(budget().windowTotal()).toBe(0);
    expect(budget().getExceedanceCount()).toBe(0);
  });

  it("counts registrations repeated for the same instance while mounted", () => {
    budget().reset();
    let flip: (() => void) | null = null;
    function Flapping() {
      const [tick, setTick] = useState(0);
      flip = () => setTick((n) => n + 1);
      return (
        <Harness instanceId={tick % 2 === 0 ? "a" : "b"}>
          <ToggleConsumer onToggle={() => ({})} />
        </Harness>
      );
    }
    render(<Flapping />);
    expect(budget().windowTotal()).toBe(0);
    for (let i = 0; i < 8; i++) act(() => flip?.());
    expect(budget().windowTotal()).toBeGreaterThan(0);
    budget().reset();
  });
});
