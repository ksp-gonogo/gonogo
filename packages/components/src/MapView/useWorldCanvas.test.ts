import { act, renderHook } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrajectoryPoint } from "./useTrajectoryBuffer";
import { useWorldCanvas } from "./useWorldCanvas";

// Regression coverage for the trajectory-jank bug: under React 18 batching +
// the reveal-gate's bursty catch-up delivery, several new buffered points can
// land inside a single commit. The draw effect must paint every new segment,
// not just the latest one — otherwise the rendered trajectory skips facets.

function point(over: Partial<TrajectoryPoint> = {}): TrajectoryPoint {
  return {
    lat: 0,
    lon: 0,
    alt: 1_000,
    q: 0,
    mach: 0,
    speed: 100,
    vSpeed: 0,
    ...over,
  };
}

function fakeCtx() {
  const calls: string[] = [];
  return {
    calls,
    strokeStyle: "",
    lineWidth: 0,
    beginPath: () => calls.push("beginPath"),
    moveTo: (x: number, y: number) => calls.push(`moveTo ${x},${y}`),
    lineTo: (x: number, y: number) => calls.push(`lineTo ${x},${y}`),
    stroke: () => calls.push("stroke"),
    clearRect: (...args: number[]) => calls.push(`clearRect ${args.join(",")}`),
  } as unknown as CanvasRenderingContext2D;
}

const adjustedMap = (_w: number, _h: number, lat: number, lon: number) => ({
  x: lat,
  y: lon,
});

describe("useWorldCanvas", () => {
  let ctx: ReturnType<typeof fakeCtx>;

  beforeEach(() => {
    ctx = fakeCtx();
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => ctx,
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  function setup(initialBodyName = "Kerbin") {
    const trajectoryRef = { current: [] as TrajectoryPoint[] };
    const hook = renderHook(
      ({
        trajectoryCount,
        bodyName,
      }: {
        trajectoryCount: number;
        bodyName: string;
      }) =>
        useWorldCanvas({
          trajectoryRef,
          trajectoryCount,
          adjustedMap,
          hasAtmosphere: false,
          maxAtmosphere: 100_000,
          bodyName,
        }),
      { initialProps: { trajectoryCount: 0, bodyName: initialBodyName } },
    );
    return { trajectoryRef, hook };
  }

  function moveToCalls() {
    return ctx.calls.filter((c) => c.startsWith("moveTo"));
  }

  it("draws every buffered segment from a batched burst, not just the latest", () => {
    const { trajectoryRef, hook } = setup();

    act(() => {
      trajectoryRef.current.push(
        point({ lat: 0, lon: 0 }),
        point({ lat: 1, lon: 1 }),
        point({ lat: 2, lon: 2 }),
        point({ lat: 3, lon: 3 }),
      );
      // One commit carrying 3 new segments (0-1, 1-2, 2-3) — mirrors a
      // reveal-gate catch-up burst landing inside a single React commit.
      hook.rerender({ trajectoryCount: 3, bodyName: "Kerbin" });
    });

    expect(moveToCalls()).toHaveLength(3);
    expect(moveToCalls()).toEqual(["moveTo 0,0", "moveTo 1,1", "moveTo 2,2"]);
  });

  it("does not re-draw already-painted segments when unrelated deps are stable", () => {
    const { trajectoryRef, hook } = setup();

    act(() => {
      trajectoryRef.current.push(point({ lat: 0 }), point({ lat: 1 }));
      hook.rerender({ trajectoryCount: 1, bodyName: "Kerbin" });
    });
    expect(moveToCalls()).toHaveLength(1);

    act(() => {
      // Same trajectoryCount, same bodyName — nothing new to draw.
      hook.rerender({ trajectoryCount: 1, bodyName: "Kerbin" });
    });
    expect(moveToCalls()).toHaveLength(1);
  });

  it("resets the drawn index on body switch instead of backfilling the old body's backlog", () => {
    const { trajectoryRef, hook } = setup();

    act(() => {
      trajectoryRef.current.push(
        point({ lat: 0 }),
        point({ lat: 1 }),
        point({ lat: 2 }),
        point({ lat: 3 }),
      );
      hook.rerender({ trajectoryCount: 3, bodyName: "Kerbin" });
    });
    expect(moveToCalls()).toHaveLength(3);

    act(() => {
      hook.rerender({ trajectoryCount: 3, bodyName: "Mun" });
    });
    expect(ctx.calls.some((c) => c.startsWith("clearRect"))).toBe(true);

    const drawnBeforeNewPoint = moveToCalls().length;

    act(() => {
      trajectoryRef.current.push(point({ lat: 4 }));
      hook.rerender({ trajectoryCount: 4, bodyName: "Mun" });
    });

    // Only the one new segment for the new body should be painted — the
    // pre-switch backlog must not get replayed onto the freshly-cleared canvas.
    expect(moveToCalls().length - drawnBeforeNewPoint).toBe(1);
  });
});
