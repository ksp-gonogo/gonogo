import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { createPanelStore } from "./createPanelStore";
import { createStore } from "./createStore";

interface Entry {
  id: string;
  label: string;
}

const PanelStore = createPanelStore(() => createStore<Entry>());

/** Captures whatever `useStore` returns on each render into `seen`. Identity is
 * what these tests assert, so double-invocation (StrictMode) is harmless: the
 * same instance captured twice is still one distinct value. */
function Probe({ seen }: { seen: unknown[] }) {
  seen.push(PanelStore.useStore());
  return null;
}

describe("createPanelStore", () => {
  it("useStore is null with no provider in the tree (no-op scoping)", () => {
    const seen: unknown[] = [];
    render(<Probe seen={seen} />);
    expect(seen.every((s) => s === null)).toBe(true);
  });

  it("provides one store instance to everything under a provider", () => {
    const seen: unknown[] = [];
    render(
      <PanelStore.Provider>
        <Probe seen={seen} />
        <Probe seen={seen} />
      </PanelStore.Provider>,
    );
    const distinct = new Set(seen);
    expect(distinct.has(null)).toBe(false);
    expect(distinct.size).toBe(1);
  });

  it("gives separate providers independent store instances", () => {
    const seen: unknown[] = [];
    render(
      <>
        <PanelStore.Provider>
          <Probe seen={seen} />
        </PanelStore.Provider>
        <PanelStore.Provider>
          <Probe seen={seen} />
        </PanelStore.Provider>
      </>,
    );
    expect(new Set(seen).size).toBe(2);
  });

  it("holds the store instance stable across re-renders", () => {
    const seen: unknown[] = [];
    const { rerender } = render(
      <PanelStore.Provider>
        <Probe seen={seen} />
      </PanelStore.Provider>,
    );
    rerender(
      <PanelStore.Provider>
        <Probe seen={seen} />
      </PanelStore.Provider>,
    );
    expect(new Set(seen).size).toBe(1);
  });
});
