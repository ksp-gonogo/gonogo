import { act, render } from "@ksp-gonogo/test-utils";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { useKeepNewestInView } from "./useKeepNewestInView";

function Log({ count }: { count: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useKeepNewestInView(ref, count);
  return <div ref={ref} data-testid="log" />;
}

function sized(el: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
  });
}

describe("keeping the newest entry in view", () => {
  it("scrolls to the bottom when an entry arrives", () => {
    const { getByTestId, rerender } = render(<Log count={1} />);
    const log = getByTestId("log");
    sized(log, 131, 108);

    rerender(<Log count={2} />);

    expect(log.scrollTop).toBe(131);
  });

  it("leaves a reader who scrolled up where they are", () => {
    const { getByTestId, rerender } = render(<Log count={1} />);
    const log = getByTestId("log");
    sized(log, 300, 100);
    log.scrollTop = 40;
    act(() => {
      log.dispatchEvent(new Event("scroll"));
    });

    rerender(<Log count={2} />);

    expect(log.scrollTop).toBe(40);
  });

  it("follows again once the reader is back at the bottom", () => {
    const { getByTestId, rerender } = render(<Log count={1} />);
    const log = getByTestId("log");
    sized(log, 300, 100);
    log.scrollTop = 40;
    act(() => {
      log.dispatchEvent(new Event("scroll"));
    });
    log.scrollTop = 200;
    act(() => {
      log.dispatchEvent(new Event("scroll"));
    });

    rerender(<Log count={2} />);

    expect(log.scrollTop).toBe(300);
  });
});
