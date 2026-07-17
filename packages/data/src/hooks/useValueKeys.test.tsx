import { clearRegistry } from "@ksp-gonogo/core";
import { mapTopic } from "@ksp-gonogo/sitrep-client";
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

  // Same "no mock DataSource" proof as useDataSchema.test.tsx — AlarmsModal,
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
    expect(captured.some((k) => k.key === "v.altitude")).toBe(true);
  });

  it("excludes bool/enum/raw-unit and 'Actions'-group keys", () => {
    let captured: DataKeyMeta[] = [];
    render(
      <Probe
        onRender={(k) => {
          captured = k;
        }}
      />,
    );

    for (const entry of captured) {
      expect(entry.unit).not.toBe("bool");
      expect(entry.unit).not.toBe("enum");
      expect(entry.unit).not.toBe("raw");
      expect(entry.group).not.toBe("Actions");
    }
  });

  // The filter's whole justification (see useValueKeys.ts's doc comment) is
  // that every surviving key must resolve to a live stream home — otherwise
  // a threshold/trigger picker could offer a key that silently never fires.
  // Assert that invariant directly against the real mapTopic, not just trust
  // the filter predicate reads correctly.
  it("every returned key resolves via mapTopic(sourceId, key)", () => {
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
      expect(mapTopic("data", entry.key)).not.toBeUndefined();
    }
  });
});
