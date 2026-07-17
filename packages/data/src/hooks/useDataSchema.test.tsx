import {
  clearRegistry,
  type DataKey,
  MockDataSource,
  registerDataSource,
} from "@ksp-gonogo/core";
import { render } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DataKeyMeta } from "../types";
import { useDataSchema } from "./useDataSchema";

function Probe({
  sourceId,
  onRender,
}: {
  sourceId?: string;
  onRender: (schema: DataKeyMeta[]) => void;
}) {
  const schema = useDataSchema(sourceId);
  onRender(schema);
  return null;
}

describe("useDataSchema", () => {
  beforeEach(() => {
    clearRegistry();
  });

  afterEach(() => {
    clearRegistry();
  });

  // Finding 1 (config-UI key pickers permanently empty): the legacy "data"
  // `DataSource` was deleted in `806e7fe2` — nothing is registered under
  // that id in the real app any more. A test that registers a mock "data"
  // source before exercising this hook (the old pattern, still used
  // elsewhere in this repo — see AlarmsModal.test.tsx) masks that
  // regression completely, since the mock always answers a non-empty
  // schema(). This test deliberately registers NOTHING to prove the real,
  // mock-free path works.
  it("returns a non-empty catalog for the legacy 'data' source with NO DataSource registered at all", () => {
    let captured: DataKeyMeta[] = [];
    render(
      <Probe
        onRender={(s) => {
          captured = s;
        }}
      />,
    );

    expect(captured.length).toBeGreaterThan(0);
    const altitude = captured.find((k) => k.key === "v.altitude");
    expect(altitude).toEqual({
      key: "v.altitude",
      label: "Altitude",
      unit: "m",
      group: "Position",
    });
  });

  it("defaults sourceId to 'data' when omitted", () => {
    let captured: DataKeyMeta[] = [];
    render(
      <Probe
        onRender={(s) => {
          captured = s;
        }}
      />,
    );

    expect(captured.some((k) => k.key === "v.altitude")).toBe(true);
  });

  it("every legacy 'data' catalog entry carries a real label (proves enrichKey ran, not a bare fallback list)", () => {
    let captured: DataKeyMeta[] = [];
    render(
      <Probe
        onRender={(s) => {
          captured = s;
        }}
      />,
    );

    for (const entry of captured) {
      expect(typeof entry.key).toBe("string");
      expect(entry.label).toBeTruthy();
      expect(entry.group).toBeTruthy();
    }
  });

  it("still reads schema() off a live registered DataSource for a non-'data' sourceId (e.g. 'kos')", () => {
    const keys: DataKey[] = [{ key: "kos.compute.my-feed.parts" }];
    registerDataSource(new MockDataSource({ id: "kos", keys }));

    let captured: DataKeyMeta[] = [];
    render(
      <Probe
        sourceId="kos"
        onRender={(s) => {
          captured = s;
        }}
      />,
    );

    expect(captured).toEqual(keys);
  });

  it("returns [] for a non-'data' sourceId with no DataSource registered", () => {
    let captured: DataKeyMeta[] | null = null;
    render(
      <Probe
        sourceId="kos"
        onRender={(s) => {
          captured = s;
        }}
      />,
    );

    expect(captured).toEqual([]);
  });
});
