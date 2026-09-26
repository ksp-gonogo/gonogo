import { type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { act, render } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelemetryClient } from "./client";
import {
  getScetUt,
  getViewUt,
  setActiveViewClockForTests,
  TelemetryProvider,
  useScetUt,
  useViewUt,
} from "./context";
import { StubTransport } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/** One-way light time, seconds. */
const OWLT = 240;
const UT_NOW = 10_000;

function installFakeRaf() {
  const pending = new Map<number, () => void>();
  let next = 1;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const handle = next++;
    pending.set(handle, () => cb(0));
    return handle;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    pending.delete(handle);
  });
  return {
    flush() {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const cb of callbacks) cb();
    },
  };
}

function mountAt(delaySeconds: number) {
  const client = new TelemetryClient(new StubTransport());
  const clock = new ViewClock({
    nowWall: () => 0,
    warpRate: () => 1,
    delaySeconds: () => delaySeconds,
  });
  clock.observeSample(UT_NOW - delaySeconds, UT_NOW);
  const store = new TimelineStore(clock);
  const seen: { view?: Value<"ut">; scet?: Value<"ut"> } = {};
  function Probe() {
    seen.view = useViewUt();
    seen.scet = useScetUt();
    return null;
  }
  render(
    <TelemetryProvider client={client} store={store}>
      <Probe />
    </TelemetryProvider>,
  );
  return { client, seen };
}

let raf: ReturnType<typeof installFakeRaf>;

beforeEach(() => {
  raf = installFakeRaf();
});

afterEach(() => {
  vi.unstubAllGlobals();
  setActiveViewClockForTests(undefined);
});

describe("useScetUt", () => {
  it("is the craft's present, a light-time past useViewUt", () => {
    const { client, seen } = mountAt(OWLT);
    act(() => raf.flush());
    expect(seen.view).toEqual(value("ut", UT_NOW - OWLT));
    expect(seen.scet).toEqual(value("ut", UT_NOW));
    client.dispose();
  });

  it("is useViewUt when there is no light-time to see", () => {
    const { client, seen } = mountAt(0);
    act(() => raf.flush());
    expect(seen.scet).toEqual(seen.view);
    client.dispose();
  });

  it("is undefined when no provider is mounted", () => {
    let seen: Value<"ut"> | undefined = value("ut", 1);
    function Probe() {
      seen = useScetUt();
      return null;
    }
    render(<Probe />);
    expect(seen).toBeUndefined();
  });
});

describe("getScetUt", () => {
  it("reads the mounted provider's clock, a light-time past getViewUt", () => {
    const { client } = mountAt(OWLT);
    expect(getViewUt()).toBe(UT_NOW - OWLT);
    expect(getScetUt()).toBe(UT_NOW);
    client.dispose();
  });

  it("answers a test clock that has no light-time as its view time", () => {
    setActiveViewClockForTests({ viewUt: () => 1_000 });
    expect(getScetUt()).toBe(1_000);
  });
});
