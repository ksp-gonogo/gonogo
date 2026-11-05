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

/*
 * The rig's light toggle to a probe at Eeloo: sent at UT 350296488.3 over a
 * 286 s one-way delay, so its reply was due at 350297060.3, and the first
 * frame showing the light on arrived at 350297068.3.
 */
const SENT_UT = 350296488.3;
const REPLY_DUE_UT = SENT_UT + 2 * 286;
const LIGHT_SHOWN_UT = 350297068.3;

const lightToggle = (): PendingEntry => ({
  id: "r1",
  clientRequestId: "c1",
  command: "vessel.control.setLights",
  label: "Toggle Light",
  topic: "",
  vantage: "ground:Kerbin: KSC",
  dispatchedAt: value("ut", SENT_UT),
  oneWaySeconds: value("s", 286),
});

const resolveToggle = (opts: {
  nowUt: number;
  confirmation?: { confirmed: boolean; answeredAtUt: number };
}) =>
  resolveTracked(
    "c1",
    { pending: [] },
    new Map([["c1", lightToggle()]]),
    new Map(),
    opts.nowUt,
    0,
    () => true,
    () => true,
    () => false,
    () => opts.confirmation,
  );

describe("resolveTracked for a command its caller confirms from the telemetry", () => {
  it("still reads due after its reply came, while the telemetry shows the old state", () => {
    const r = resolveToggle({
      nowUt: REPLY_DUE_UT + 2,
      confirmation: { confirmed: false, answeredAtUt: REPLY_DUE_UT + 0.3 },
    });
    expect(r).toMatchObject({
      kind: "classified",
      item: { predictedPhase: "due" },
    });
  });

  it("resolves once the telemetry shows what it set", () => {
    const r = resolveToggle({
      nowUt: LIGHT_SHOWN_UT,
      confirmation: { confirmed: true, answeredAtUt: REPLY_DUE_UT + 0.3 },
    });
    expect(r.kind).toBe("resolved");
  });

  it("reads overdue when the telemetry has not shown it a minute after the reply", () => {
    const r = resolveToggle({
      nowUt: REPLY_DUE_UT + 61,
      confirmation: { confirmed: false, answeredAtUt: REPLY_DUE_UT + 0.3 },
    });
    expect(r).toMatchObject({
      kind: "classified",
      item: { predictedPhase: "overdue" },
    });
  });

  it("counts the minute from a reply that came later than predicted", () => {
    const r = resolveToggle({
      nowUt: REPLY_DUE_UT + 61,
      confirmation: { confirmed: false, answeredAtUt: REPLY_DUE_UT + 30 },
    });
    expect(r).toMatchObject({
      kind: "classified",
      item: { predictedPhase: "due" },
    });
  });

  it("resolves at its reply, as before, when nothing confirms it: no check, or a refusal", () => {
    expect(resolveToggle({ nowUt: REPLY_DUE_UT + 2 }).kind).toBe("resolved");
  });
});
