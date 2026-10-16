import { describe, expect, it } from "vitest";
import type { PendingEntry } from "../command-delay";
import { value } from "../unit-system/value";
import { resolveTracked } from "./resolve-tracked";

const noRoute = (): PendingEntry => ({
  id: "r1",
  clientRequestId: "c1",
  command: "vessel.control.setSas",
  label: "SAS",
  topic: "",
  vantage: "ksc",
  dispatchedAt: value("ut", 100),
  oneWaySeconds: null,
});

const resolve = (opts: { acked: boolean; lost: boolean; nowUt: number }) =>
  resolveTracked(
    "c1",
    { pending: [noRoute()] },
    new Map(),
    new Map(),
    opts.nowUt,
    0,
    () => true,
    () => opts.acked,
    () => opts.lost,
  );

describe("resolveTracked for a command sent with no route", () => {
  it("stays in transit while the client has not judged it", () => {
    const r = resolve({ acked: false, lost: false, nowUt: 500 });
    expect(r).toMatchObject({
      kind: "classified",
      item: { predictedPhase: "in-transit" },
    });
  });

  it("reads lost once the client has judged it lost, instead of in transit for ever", () => {
    const r = resolve({ acked: false, lost: true, nowUt: 500 });
    expect(r).toMatchObject({
      kind: "classified",
      item: { predictedPhase: "lost" },
    });
  });

  it("resolves when an answer came back, even after it was judged lost", () => {
    expect(resolve({ acked: true, lost: false, nowUt: 500 }).kind).toBe(
      "resolved",
    );
  });
});
