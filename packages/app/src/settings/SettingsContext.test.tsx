import { act, render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { Component, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerSetting } from "./registry";
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
    // Silence React's error boundary noise: the throw is the test assertion.
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
    if (!(caught instanceof Error)) {
      throw new Error(`expected an Error, got: ${String(caught)}`);
    }
    expect(caught.message).toMatch(/SettingsProvider/);
    window.removeEventListener("error", swallowError);
    spy.mockRestore();
  });

  describe("with no default given", () => {
    function Bare({ keyName }: { keyName: string }) {
      const [value] = useSetting<boolean>(keyName);
      return <output data-testid="value">{String(value)}</output>;
    }

    it("reads the default of the row registered under the key", () => {
      registerSetting({
        id: "test.registeredDefaultOff",
        label: "Registered default",
        category: "Test",
        defaultValue: false,
      });
      render(
        <SettingsProvider service={service}>
          <Bare keyName="test.registeredDefaultOff" />
        </SettingsProvider>,
      );
      expect(screen.getByTestId("value").textContent).toBe("false");
    });

    it("lets an explicit default win over the registered one", () => {
      registerSetting({
        id: "test.registeredDefaultOverridden",
        label: "Registered default",
        category: "Test",
        defaultValue: false,
      });
      function Explicit() {
        const [value] = useSetting<boolean>(
          "test.registeredDefaultOverridden",
          true,
        );
        return <output data-testid="value">{String(value)}</output>;
      }
      render(
        <SettingsProvider service={service}>
          <Explicit />
        </SettingsProvider>,
      );
      expect(screen.getByTestId("value").textContent).toBe("true");
    });

    it("throws for a key with no registered client setting", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const swallowError = (e: ErrorEvent) => e.preventDefault();
      window.addEventListener("error", swallowError);
      let caught: unknown;
      render(
        <SettingsProvider service={service}>
          <CatchBoundary
            onError={(err) => {
              caught = err;
            }}
          >
            <Bare keyName="test.neverRegistered" />
          </CatchBoundary>
        </SettingsProvider>,
      );
      if (!(caught instanceof Error)) {
        throw new Error(`expected an Error, got: ${String(caught)}`);
      }
      expect(caught.message).toMatch(/test\.neverRegistered/);
      window.removeEventListener("error", swallowError);
      spy.mockRestore();
    });
  });
});
