import { act, render } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScrollerHeight } from "./useScrollerHeight";

const BODY_BOTTOM = 500;

type Observer = { callback: () => void; targets: Set<Element> };
const observers: Observer[] = [];

function fireResize(target: Element) {
  for (const o of observers) if (o.targets.has(target)) o.callback();
}

function Harness() {
  const [measure, frame] = useScrollerHeight();
  return (
    <div data-panel-body="" data-testid="body">
      <section data-testid="above" />
      <div ref={measure} data-testid="row" data-height={frame.height} />
    </div>
  );
}

describe("useScrollerHeight", () => {
  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        private readonly entry: Observer;
        constructor(callback: () => void) {
          this.entry = { callback, targets: new Set() };
          observers.push(this.entry);
        }
        observe(target: Element) {
          this.entry.targets.add(target);
        }
        unobserve(target: Element) {
          this.entry.targets.delete(target);
        }
        disconnect() {
          this.entry.targets.clear();
        }
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("re-measures when a section above the row grows, so the rail still ends at the body's bottom", async () => {
    let sectionHeight = 40;
    const rect = (top: number) => ({ top }) as DOMRect;
    const { getByTestId } = render(<Harness />);
    const body = getByTestId("body");
    const row = getByTestId("row");
    Object.defineProperty(body, "clientHeight", { value: BODY_BOTTOM });
    body.getBoundingClientRect = () => rect(0);
    row.getBoundingClientRect = () => rect(sectionHeight);
    const above = getByTestId("above");

    await act(async () => {
      fireResize(body);
    });
    expect(row.getAttribute("data-height")).toBe(String(BODY_BOTTOM - 40));

    sectionHeight = 90;
    await act(async () => {
      fireResize(above);
    });
    expect(row.getAttribute("data-height")).toBe(String(BODY_BOTTOM - 90));
  });
});
