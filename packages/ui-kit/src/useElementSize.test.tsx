import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  type DrivableResizeObservers,
  installDrivableResizeObserver,
} from "./testing";
import { useElementSize } from "./useElementSize";

let observers: DrivableResizeObservers | null = null;
afterEach(() => {
  observers?.uninstall();
  observers = null;
});

function Measured({ which }: { which: "none" | "a" | "b" }) {
  const { ref, size } = useElementSize<HTMLDivElement>({ w: 7, h: 7 });
  return (
    <>
      <output>{`${size.w}x${size.h}`}</output>
      {which === "a" && <div key="a" data-testid="a" ref={ref} />}
      {which === "b" && <div key="b" data-testid="b" ref={ref} />}
    </>
  );
}

describe("useElementSize", () => {
  it("observes an element that mounts after the first render", () => {
    observers = installDrivableResizeObserver();
    const { rerender } = render(<Measured which="none" />);
    rerender(<Measured which="a" />);
    act(() =>
      observers?.resize(screen.getByTestId("a"), { width: 120, height: 40 }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("120x40");
  });

  it("follows the ref to a replacement element and stops observing the old one", () => {
    observers = installDrivableResizeObserver();
    const { rerender } = render(<Measured which="a" />);
    const first = screen.getByTestId("a");
    rerender(<Measured which="b" />);
    act(() => observers?.resize(first, { width: 50, height: 50 }));
    expect(screen.getByRole("status")).toHaveTextContent("7x7");
    act(() =>
      observers?.resize(screen.getByTestId("b"), { width: 300, height: 40 }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("300x40");
  });
});
