import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScrollIntoViewOnAdd } from "./useScrollIntoViewOnAdd";

function Host({
  cellId,
  lastAddedId,
}: {
  cellId: string | null;
  lastAddedId: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollIntoViewOnAdd(ref, lastAddedId, undefined);
  return <div ref={ref}>{cellId ? <div data-i={cellId} /> : null}</div>;
}

function LateCell() {
  const [cellId, setCellId] = useState<string | null>(null);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setLastAddedId("new");
          setTimeout(() => setCellId("new"), 100);
        }}
      >
        add
      </button>
      <Host cellId={cellId} lastAddedId={lastAddedId} />
    </>
  );
}

describe("useScrollIntoViewOnAdd", () => {
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    scrollIntoView.mockClear();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("scrolls to a cell that is already drawn", async () => {
    render(<Host cellId="new" lastAddedId="new" />);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
  });

  it("scrolls to a cell that is drawn some frames after the id is set", async () => {
    const view = render(<LateCell />);
    await act(async () => {
      view.getByRole("button", { name: "add" }).click();
    });
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
  });
});
