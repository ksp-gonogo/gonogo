import { describe, expect, it } from "vitest";
import type { DeviceInput } from "../types";
import { parseJsonState } from "./jsonState";

describe("parseJsonState", () => {
  it("returns a malformed flag for non-JSON input", () => {
    const r = parseJsonState("not json", []);
    expect(r.malformed).toBe(true);
    expect(r.events).toEqual([]);
  });

  it("ignores empty / whitespace-only lines without reporting malformed", () => {
    const r = parseJsonState("   ", []);
    expect(r.malformed).toBe(false);
    expect(r.events).toEqual([]);
    expect(r.inputsUpdate).toBeNull();
  });

  it("rejects JSON arrays / scalars (only objects are valid messages)", () => {
    expect(parseJsonState("[1,2,3]", []).malformed).toBe(true);
    expect(parseJsonState("42", []).malformed).toBe(true);
  });

  it("emits button events and registers unknown buttons in inputsUpdate", () => {
    const line = JSON.stringify({ btn: { A: 1, B: 0 } });
    const r = parseJsonState(line, []);
    expect(r.events).toEqual([
      { inputId: "A", value: true },
      { inputId: "B", value: false },
    ]);
    expect(r.inputsUpdate).toEqual([
      { id: "A", name: "A", kind: "button" },
      { id: "B", name: "B", kind: "button" },
    ]);
  });

  it("doesn't re-announce buttons that are already known", () => {
    const known: DeviceInput[] = [
      { id: "A", name: "A", kind: "button" },
      { id: "B", name: "B", kind: "button" },
    ];
    const line = JSON.stringify({ btn: { A: 1, B: 1 } });
    const r = parseJsonState(line, known);
    expect(r.events).toHaveLength(2);
    expect(r.inputsUpdate).toBeNull();
  });

  it("normalises analogs to -1..1 using declared min/max", () => {
    const line = JSON.stringify({
      analog: {
        X: { val: 0, min: 0, max: 1023 },
        Y: { val: 512, min: 0, max: 1023 },
        Z: { val: 1023, min: 0, max: 1023 },
      },
    });
    const r = parseJsonState(line, []);
    expect(r.events[0]).toEqual({ inputId: "X", value: -1 });
    expect(r.events[1].value).toBeCloseTo(0, 2);
    expect(r.events[2]).toEqual({ inputId: "Z", value: 1 });
  });

  it("falls back to cached min/max when the firmware elides them after first tick", () => {
    const known: DeviceInput[] = [
      { id: "X", name: "X", kind: "analog", min: 0, max: 1023 },
    ];
    // Short-form payload: just the scalar value.
    const r = parseJsonState(JSON.stringify({ analog: { X: 100 } }), known);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].inputId).toBe("X");
    expect(r.events[0].value).toBeCloseTo(-0.8, 2);
    // No schema change, inputsUpdate should be null.
    expect(r.inputsUpdate).toBeNull();
  });

  it("fires an inputsUpdate when an analog's declared min/max changes", () => {
    const known: DeviceInput[] = [
      { id: "X", name: "X", kind: "analog", min: 0, max: 1023 },
    ];
    const line = JSON.stringify({
      analog: { X: { val: 500, min: 0, max: 4095 } }, // 12-bit ADC
    });
    const r = parseJsonState(line, known);
    expect(r.inputsUpdate).toEqual([
      { id: "X", name: "X", kind: "analog", min: 0, max: 4095 },
    ]);
  });

  it("registers previously-unknown analogs with their declared range", () => {
    const line = JSON.stringify({
      analog: {
        Throttle: { val: 200, min: 0, max: 1023 },
      },
    });
    const r = parseJsonState(line, []);
    expect(r.inputsUpdate).toEqual([
      { id: "Throttle", name: "Throttle", kind: "analog", min: 0, max: 1023 },
    ]);
    expect(r.events[0].inputId).toBe("Throttle");
  });

  it("skips an analog with no usable range (no cached, no declared)", () => {
    // Short-form value without a prior declaration → no event, no schema
    // update (we can't classify it correctly yet).
    const r = parseJsonState(JSON.stringify({ analog: { X: 100 } }), []);
    expect(r.events).toEqual([]);
    expect(r.inputsUpdate).toBeNull();
  });

  it("emits screenUpdate when a screen block is present", () => {
    const line = JSON.stringify({
      btn: { A: 0 },
      screen: { type: "txt", w: 21, h: 8 },
    });
    const r = parseJsonState(line, []);
    expect(r.screenUpdate).toEqual({ type: "txt", w: 21, h: 8 });
  });

  it("returns null screenUpdate when no screen block", () => {
    const line = JSON.stringify({ btn: { A: 0 } });
    expect(parseJsonState(line, []).screenUpdate).toBeNull();
  });

  it("ignores screen blocks without a string `type`", () => {
    const line = JSON.stringify({ screen: { w: 21, h: 8 } });
    expect(parseJsonState(line, []).screenUpdate).toBeNull();
  });

  it("preserves unrelated known inputs in the merged update", () => {
    const known: DeviceInput[] = [
      { id: "A", name: "A", kind: "button" },
      { id: "X", name: "X", kind: "analog", min: 0, max: 1023 },
    ];
    // Adds Y. A and X should carry through untouched in the merged update.
    const line = JSON.stringify({
      analog: { Y: { val: 0, min: 0, max: 100 } },
    });
    const r = parseJsonState(line, known);
    expect(r.inputsUpdate).toEqual([
      { id: "A", name: "A", kind: "button" },
      { id: "X", name: "X", kind: "analog", min: 0, max: 1023 },
      { id: "Y", name: "Y", kind: "analog", min: 0, max: 100 },
    ]);
  });

  it("interprets string and numeric button payloads uniformly", () => {
    const line = JSON.stringify({
      btn: { A: "1", B: 0, C: true, D: "0", E: "" },
    });
    const r = parseJsonState(line, []);
    expect(r.events).toEqual([
      { inputId: "A", value: true },
      { inputId: "B", value: false },
      { inputId: "C", value: true },
      { inputId: "D", value: false },
      { inputId: "E", value: false },
    ]);
  });
});
