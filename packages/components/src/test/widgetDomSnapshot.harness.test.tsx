import { registerComponent, useTelemetry } from "@ksp-gonogo/core";
import { useViewClockOptional } from "@ksp-gonogo/sitrep-client";
import type { VesselControl } from "@ksp-gonogo/sitrep-sdk";
import { useEffect, useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { renderWidgetMode, snapshotWidgetMode } from "./widgetDomSnapshot";

/**
 * The harness has to actually FEED the widget, and the assertions that would
 * normally notice cannot say so.
 *
 * A widget rendered with nothing behind it still renders: a title bar, an empty
 * state, a placeholder. `toMatchSnapshot` records that render as the expected
 * one and passes forever after, and `expectNoA11yViolations` over a page with
 * nothing on it passes too. Both instruments report success in exactly the
 * situation they exist to catch, so neither can be the check on the harness
 * that produced the page.
 *
 * These tests are that check. Each mounts a probe widget that renders ONE thing
 * and renders nothing at all without it, so "the harness fed me" and "the
 * assertion passed" become the same statement. Each covers a way the harness
 * has been found silently feeding nothing:
 *
 *  - a fixture's own `_stream` block ignored, so a widget on canonical stream
 *    reads got no telemetry (201 fixtures carry one)
 *  - a `ResizeObserver` that never calls back, so anything gated on a measured
 *    box never rendered (all 48 KeplerPeriod baselines were one blank panel)
 *  - the widget's REGISTERED `defaultConfig` never applied, so a mode with no
 *    config overlay rendered the not-configured placeholder (24 of ActionGroup's
 *    48)
 *
 * To check this file still works, break the thing it names: delete the
 * `resolveStreamBlock` branch from `buildStreamWrap`, or the
 * `installSizedResizeObserver` call, or the `baselineConfig` fallback, and the
 * matching test must go red. It does; that is why they assert on rendered text
 * rather than on the harness's internals.
 */

const MODE = { name: "probe", w: 8, h: 8 };

/** Renders the streamed SAS flag, and nothing whatsoever without one. */
function StreamProbe() {
  const reading = useTelemetry("vessel.control");
  const control = reading?.value as VesselControl | undefined;
  if (control?.sas === undefined) return null;
  return <span>{`sas=${String(control.sas)}`}</span>;
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
  category: "telemetry",
  component: ConfigProbe as never,
  dataRequirements: [],
  behaviors: [],
  defaultConfig: { marker: "from-registry" },
});

/**
 * Carries a `_stream` block and NO flat legacy keys, so none of the harness's
 * legacy-key reshapes can rescue it: the only route from this object to the
 * widget is the block itself.
 */
const STREAM_ONLY_FIXTURE = {
  _meta: { scenario: "harness-guard" },
  _stream: {
    carriedChannels: ["vessel.control"],
    pinnedUt: 0,
    emits: [{ channel: "vessel.control", value: { sas: true } }],
  },
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

  it("reports a measured size, so size-gated content renders", async () => {
    const html = await snapshotWidgetMode({
      Widget: SizeProbe,
      fixture: {},
      mode: MODE,
    });
    // 8 columns: 8 * 32 + 7 * 8, the grid arithmetic the playwright harness
    // sizes its iframe with. Asserting the number, not merely "non-zero", so a
    // harness that hard-codes one constant for every mode fails here.
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

  /**
   * The clock's frame loop reschedules itself forever by design, so a mounted
   * `TelemetryProvider` mints a React update every animation frame whether or
   * not anything arrived. React's async `act()` drains its queue and then
   * requires the queue to be EMPTY, so a frame landing in that window means it
   * never is and the mount hangs until vitest's timeout. Whether it hangs comes
   * down to whether one drain finishes inside one frame interval, which is a
   * property of the machine: measured on CI it was two populations, ~250ms and
   * exactly 30000ms, across an unchanged tree.
   *
   * So the harness suspends the fixture clock and mints frames itself. This
   * asserts the invariant that makes the settle phases able to finish, rather
   * than the hang, which is what a timing test could only observe by being slow
   * on a fast machine.
   */
  it("leaves no frame loop running behind a mounted widget", async () => {
    const { container, teardown } = await renderWidgetMode({
      Widget: FrameCountProbe,
      fixture: STREAM_ONLY_FIXTURE,
      mode: MODE,
    });
    try {
      const settled = container.textContent;
      // Comfortably more than jsdom's 16ms animation frame: a live loop puts
      // several frames through here, a suspended one puts none.
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
      expect(container.textContent).toBe(settled);
    } finally {
      teardown();
    }
  });
});
