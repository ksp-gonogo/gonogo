import { clearRegistry } from "@ksp-gonogo/core";
import { resolveValueTopic } from "@ksp-gonogo/sitrep-client";
import { render } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DataKeyMeta } from "../types";
import { useValueKeys } from "./useValueKeys";

function Probe({
  sourceId,
  onRender,
}: {
  sourceId?: string;
  onRender: (keys: DataKeyMeta[]) => void;
}) {
  const keys = useValueKeys(sourceId);
  onRender(keys);
  return null;
}

describe("useValueKeys", () => {
  beforeEach(() => {
    clearRegistry();
  });

  afterEach(() => {
    clearRegistry();
  });

  // Same "no mock DataSource" proof as useDataSchema.test.tsx, AlarmsModal,
  // Graph, MapViewConfig and TriggerEditor all call `useValueKeys("data")`
  // with nothing registered under that id in the real app (the legacy
  // `DataSource` was deleted in `806e7fe2`). A test that pre-registers a
  // mock "data" source hides the "always returns []" regression this hook
  // exists to fix.
  it("returns a non-empty Value-typed subset for 'data' with NO DataSource registered at all", () => {
    let captured: DataKeyMeta[] = [];
    render(
      <Probe
        onRender={(k) => {
          captured = k;
        }}
      />,
    );

    expect(captured.length).toBeGreaterThan(0);
    expect(captured.some((k) => k.key === "vessel.state.altitudeAsl")).toBe(
      true,
    );
  });

  it("offers only fields with a magnitude, so every choice can be ordered", () => {
    let captured: DataKeyMeta[] = [];
    render(
      <Probe
        onRender={(k) => {
          captured = k;
        }}
      />,
    );

    // Asserted against the contract's OWN non-quantity tokens. The check this
    // replaces tested for `"bool"` and `"raw"`, which the contract does not
    // emit, so it admitted every flag and enum it was written to exclude.
    for (const entry of captured) {
      expect(entry.unit).not.toBe("flag");
      expect(entry.unit).not.toBe("enum");
      expect(entry.unit).not.toBe("text");
      expect(entry.unit).not.toBe("id");
      expect(entry.unit).toBeDefined();
    }
  });

  it("offers no collection, which has no single value to compare", () => {
    let captured: DataKeyMeta[] = [];
    render(
      <Probe
        onRender={(k) => {
          captured = k;
        }}
      />,
    );

    expect(
      captured.filter((k) => k.key === "career.status.contracts.active"),
    ).toEqual([]);
  });

  // The filter's whole justification (see useValueKeys.ts's doc comment) is
  // that every surviving key must resolve to a live stream home; otherwise a
  // threshold or trigger picker could offer a key that silently never fires.
  // Asserted directly against the real resolution rather than trusting that
  // the filter predicate reads correctly.
  it("every returned key resolves to a Topic something can sample", () => {
    let captured: DataKeyMeta[] = [];
    render(
      <Probe
        onRender={(k) => {
          captured = k;
        }}
      />,
    );

    expect(captured.length).toBeGreaterThan(0);
    for (const entry of captured) {
      expect(resolveValueTopic("data", entry.key)).not.toBeUndefined();
    }
  });
});
