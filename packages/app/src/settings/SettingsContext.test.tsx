import { act, render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { Component, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsProvider, useSetting } from "./SettingsContext";
import { SettingsService } from "./SettingsService";

class CatchBoundary extends Component<
  { children: ReactNode; onError: (err: unknown) => void },
  { caught: boolean }
> {
  state = { caught: false };
  static getDerivedStateFromError() {
    return { caught: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  render() {
    return this.state.caught ? null : this.props.children;
  }
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    length: 0,
    clear: () => map.clear(),
    key: () => null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
  } as Storage;
}

function FlagReadout({ keyName }: { keyName: string }) {
  const [value, setValue] = useSetting<boolean>(keyName, true);
  return (
    <>
      <output data-testid="value">{String(value)}</output>
      <button type="button" onClick={() => setValue(!value)}>
        toggle
      </button>
    </>
  );
}

describe("useSetting", () => {
  let service: SettingsService;

  beforeEach(() => {
    service = new SettingsService(memoryStorage());
  });

  it("returns the stored value when present, or the fallback otherwise", () => {
    service.set("flag", false);
    render(
      <SettingsProvider service={service}>
        <FlagReadout keyName="flag" />
      </SettingsProvider>,
    );
    expect(screen.getByTestId("value").textContent).toBe("false");
  });

  it("propagates external writes to subscribed components", () => {
    render(
      <SettingsProvider service={service}>
        <FlagReadout keyName="flag" />
      </SettingsProvider>,
    );
    expect(screen.getByTestId("value").textContent).toBe("true");
    act(() => {
      service.set("flag", false);
    });
    expect(screen.getByTestId("value").textContent).toBe("false");
  });

  it("persists writes from the setter back through the service", async () => {
    const user = userEvent.setup();
    render(
      <SettingsProvider service={service}>
        <FlagReadout keyName="flag" />
      </SettingsProvider>,
    );
    await user.click(screen.getByRole("button", { name: "toggle" }));
    expect(service.get("flag", true)).toBe(false);
    expect(screen.getByTestId("value").textContent).toBe("false");
  });

  it("throws when used outside a SettingsProvider", () => {
    // Silence React's error boundary noise — the throw is the test assertion.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const swallowError = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener("error", swallowError);
    let caught: unknown;
    render(
      <CatchBoundary
        onError={(err) => {
          caught = err;
        }}
      >
        <FlagReadout keyName="flag" />
      </CatchBoundary>,
    );
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/SettingsProvider/);
    window.removeEventListener("error", swallowError);
    spy.mockRestore();
  });
});
