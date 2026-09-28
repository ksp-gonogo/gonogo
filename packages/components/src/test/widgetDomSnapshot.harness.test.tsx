import { registerComponent, useTelemetry } from "@ksp-gonogo/core";
import { useViewClockOptional } from "@ksp-gonogo/sitrep-client";
import { useEffect, useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { renderWidgetMode, snapshotWidgetMode } from "./widgetDomSnapshot";

/**
 * The harness has to actually feed the widget, and a snapshot or a11y
 * assertion over an empty render passes anyway. Each probe widget here renders
 * one thing and nothing without it, so "the harness fed me" and "the
 * assertion passed" are the same statement. Covered: a fixture's `_stream`
 * block, a `ResizeObserver` that reports a size, the registered
 * `defaultConfig`, and a scene staged as held.
 */

const MODE = { name: "probe", w: 8, h: 8 };

/** Renders the streamed SAS flag, and nothing whatsoever without one. */
function StreamProbe() {
  const reading = useTelemetry("vessel.control");
  if (reading.state !== "observed") return null;
  const { sas } = reading.value;
  if (sas === undefined) return null;
  return <span>{`sas=${String(sas)}`}</span>;
}

/**
 * Renders how current the reading is, and the value with it: a held
 * scene must arrive as `stale` and still carry the figure.
 */
function CurrencyProbe() {
  const reading = useTelemetry("vessel.control");
  if (reading.state !== "observed" && reading.state !== "stale") {
    return <span>{`state=${reading.state}`}</span>;
  }
  return (
    <span>{`state=${reading.state} sas=${String(reading.value.sas)}`}</span>
  );
}

/** Renders its observed width, and nothing until something reports one. */
function SizeProbe() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(Math.round(entries[0].contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <div ref={ref}>{width === null ? null : `width=${width}`}</div>;
}

/** Counts view-clock frames and renders the running total. */
function FrameCountProbe() {
  const clock = useViewClockOptional();
  const [frames, setFrames] = useState(0);
  useEffect(() => {
    if (!clock) return;
    return clock.onFrame(() => setFrames((n) => n + 1));
  }, [clock]);
  return <span>{`frames=${frames}`}</span>;
}

/** Renders a config value the harness can only get from the registry. */
function ConfigProbe({ config }: { config?: { marker?: string } }) {
  if (config?.marker === undefined) return null;
  return <span>{`marker=${config.marker}`}</span>;
}

registerComponent({
  id: "harness-config-probe",
  name: "Harness Config Probe",
  description: "Renders a config value only the registry can supply.",
  tags: ["telemetry"],
  component: ConfigProbe as never,
  dataRequirements: [],
  behaviors: [],
  defaultConfig: { marker: "from-registry" },
});

/** Fails inside the harness's render, to exercise its restore path. */
function ThrowsOnRender(): never {
  throw new Error("planted render failure");
}

/** A `_stream` block and no flat legacy keys, so only the block can reach the widget. */
const STREAM_ONLY_FIXTURE = {
  _meta: { scenario: "harness-guard" },
  _stream: {
    pinnedUt: 0,
    emits: [{ channel: "vessel.control", value: { sas: true } }],
  },
};

/** The same wire staged as no longer arriving: two scenes differing only by the drop must not render the same. */
const STOPPED_ARRIVING_FIXTURE = {
  ...STREAM_ONLY_FIXTURE,
  _stream: { ...STREAM_ONLY_FIXTURE._stream, stopsArriving: true },
};

describe("widget DOM harness feeds the widget", () => {
  it("delivers a fixture's own _stream emits", async () => {
    const html = await snapshotWidgetMode({
      Widget: StreamProbe,
      fixture: STREAM_ONLY_FIXTURE,
      mode: MODE,
    });
    expect(html).toContain("sas=true");
  });

  it("delivers _stream emits to the live-render path too", async () => {
    const { container, teardown } = await renderWidgetMode({
      Widget: StreamProbe,
      fixture: STREAM_ONLY_FIXTURE,
      mode: MODE,
    });
    try {
      expect(container.textContent).toContain("sas=true");
    } finally {
      teardown();
    }
  });

  // The first of a pair: without the flag a scene stays current, so an unconditional drop fails here.
  it("leaves a scene current when it does not ask to stop arriving", async () => {
    const html = await snapshotWidgetMode({
      Widget: CurrencyProbe,
      fixture: STREAM_ONLY_FIXTURE,
      mode: MODE,
    });
    expect(html).toContain("state=observed sas=true");
  });

  it("stages a scene as held, holding its figures", async () => {
    const html = await snapshotWidgetMode({
      Widget: CurrencyProbe,
      fixture: STOPPED_ARRIVING_FIXTURE,
      mode: MODE,
    });
    expect(html).toContain("state=stale sas=true");
  });

  it("stages a held scene on the live-render path too", async () => {
    const { container, teardown } = await renderWidgetMode({
      Widget: CurrencyProbe,
      fixture: STOPPED_ARRIVING_FIXTURE,
      mode: MODE,
    });
    try {
      expect(container.textContent).toContain("state=stale sas=true");
    } finally {
      teardown();
    }
  });

  it("reports a measured size, so size-gated content renders", async () => {
    const html = await snapshotWidgetMode({
      Widget: SizeProbe,
      fixture: {},
      mode: MODE,
    });
    // 8 * 32 + 7 * 8, the playwright harness's grid arithmetic, asserted exactly so a constant fails.
    expect(html).toContain("width=312");
  });

  it("applies the widget's registered defaultConfig", async () => {
    const html = await snapshotWidgetMode({
      Widget: ConfigProbe,
      fixture: {},
      mode: MODE,
    });
    expect(html).toContain("marker=from-registry");
  });

  it("lets a per-mode config override the registered default", async () => {
    const html = await snapshotWidgetMode({
      Widget: ConfigProbe,
      fixture: {},
      mode: { ...MODE, config: { marker: "from-mode" } },
    });
    expect(html).toContain("marker=from-mode");
  });

  it("releases the sized ResizeObserver when a live render throws", async () => {
    await expect(
      renderWidgetMode({
        Widget: ThrowsOnRender,
        fixture: STREAM_ONLY_FIXTURE,
        mode: MODE,
      }),
    ).rejects.toThrow();
    // The next render installs its own observer; one still held by the failed render would refuse it, and every later scene would fail for that reason.
    const { teardown } = await renderWidgetMode({
      Widget: FrameCountProbe,
      fixture: STREAM_ONLY_FIXTURE,
      mode: MODE,
    });
    teardown();
  });

  // A live frame loop keeps act()'s queue from ever emptying, so the harness suspends it and mints frames itself.
  it("leaves no frame loop running behind a mounted widget", async () => {
    const { container, teardown } = await renderWidgetMode({
      Widget: FrameCountProbe,
      fixture: STREAM_ONLY_FIXTURE,
      mode: MODE,
    });
    try {
      const settled = container.textContent;
      // Comfortably more than jsdom's 16ms animation frame: a live loop puts several frames through here, a suspended one puts none.
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
      expect(container.textContent).toBe(settled);
    } finally {
      teardown();
    }
  });
});
