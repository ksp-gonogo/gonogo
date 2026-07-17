import { render } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

function Thrower({ msg }: { msg: string }) {
  throw new Error(msg);
}

describe("ErrorBoundary", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const suppressWindowError = (e: ErrorEvent) => {
    e.preventDefault();
  };

  beforeEach(() => {
    // Three sources of noise for a caught-error test:
    //   1. React logs its "The above error occurred in..." boundary warning to
    //      console.error (we silence via spy).
    //   2. React 18 also calls globalThis.reportError, which jsdom routes
    //      through a window `'error'` event whose default handler prints the
    //      full stack to stderr. preventDefault on that event stops it.
    //   3. jsdom's "Uncaught [Error]" fallback for anything that escapes both
    //      of the above. The spy catches this too.
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    window.addEventListener("error", suppressWindowError);
  });

  afterEach(() => {
    window.removeEventListener("error", suppressWindowError);
    consoleErrorSpy.mockRestore();
  });

  it("renders children when no error is thrown", () => {
    const { getByText } = render(
      <ErrorBoundary>
        <div>safe content</div>
      </ErrorBoundary>,
    );
    expect(getByText("safe content")).not.toBeNull();
  });

  it("renders the default message when no fallback is provided", () => {
    const { getByText } = render(
      <ErrorBoundary>
        <Thrower msg="boom" />
      </ErrorBoundary>,
    );
    expect(getByText("Something went wrong.")).not.toBeNull();
  });

  it("calls the fallback with the caught error and a reset handler", () => {
    const fallback = vi.fn((error: Error) => (
      <div>caught: {error.message}</div>
    ));

    const { getByText } = render(
      <ErrorBoundary fallback={fallback}>
        <Thrower msg="kaboom" />
      </ErrorBoundary>,
    );

    expect(getByText("caught: kaboom")).not.toBeNull();
    expect(fallback).toHaveBeenCalled();
    const [error, reset] = fallback.mock.calls[0];
    expect(error.message).toBe("kaboom");
    expect(typeof reset).toBe("function");
  });
});
