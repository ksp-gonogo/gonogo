import { act, render } from "@ksp-gonogo/test-utils";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installRendezvousBox, installTextWidths } from "../test/rendezvousBox";
import { flushResizeObservers } from "../test/widgetDomSnapshot";
import { useOwnSize } from "./useOwnSize";

function Late() {
  const [shown, setShown] = useState(false);
  const { ref, size } = useOwnSize<HTMLSpanElement>();
  return (
    <div>
      <button type="button" onClick={() => setShown(true)}>
        show
      </button>
      {shown && <span ref={ref}>twelve chars</span>}
      <output data-testid="width">{size.w}</output>
    </div>
  );
}

const restore: Array<() => void> = [];
beforeEach(() => {
  restore.push(installRendezvousBox(), installTextWidths(7, 18));
});
afterEach(() => {
  while (restore.length > 0) restore.pop()?.();
});

describe("useOwnSize", () => {
  it("measures an element that mounts after the first render", async () => {
    const view = render(<Late />);
    await flushResizeObservers();
    await act(async () => {
      view.getByRole("button").click();
    });
    await flushResizeObservers();
    expect(view.getByTestId("width").textContent).toBe("84");
  });
});
