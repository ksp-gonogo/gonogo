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

  it("does NOT re-register handlers on parent re-render — even when the handlers object identity changes every render", () => {
    // Reset the budget so the assertion is sensitive to this test's calls.
    const budget = PerfBudget.getAll().find((b) =>
      b.name.startsWith("useActionInput register"),
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
      // Inline object literal — fresh identity every render. Pre-fix
      // this used to re-run the effect each tick.
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
    // One initial registration on mount.
    expect(budget.getExceedanceCount()).toBe(0);
    const registrationsAfterMount = budget.rate();
    expect(registrationsAfterMount).toBe(1);

    // Force ten parent re-renders with fresh handler-object identities.
    for (let i = 0; i < 10; i++) {
      act(() => {
        triggerRender?.();
      });
    }
    // No additional registrations — the proxy stays put.
    expect(budget.rate()).toBe(1);

    // The proxy still routes to the latest closure: dispatch fires the
    // current handler, which sees the up-to-date spy.
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
