/**
 * A Ground Track mounted after its craft has flown for a while: the stream holds
 * the flight so far and the map opens onto it. A sibling widget keeps the flight
 * topics subscribed while the map is withheld, as the rest of a dashboard does.
 * The driver is `render-ground-track-late`.
 */
import { useTelemetry } from "@ksp-gonogo/core";
import { type ReactNode, useState } from "react";
import fixture from "../../src/GroundTrack/__fixtures__/kerbin-over-desert.json";
import { probePayload } from "./payload";
import { mountProbe, type ProbeMount } from "./probe-entry";

const FLOWN_SECONDS = 600;
const DEGREES_PER_SECOND = 0.17;

export interface LateScene {
  mount(opts: { w: number; h: number; flownSeconds?: number }): Promise<void>;
  /** Opens the map onto what the stream holds, then lets the draw settle. */
  openMap(): Promise<void>;
}

let reveal: () => void = () => {};
let mounted: ProbeMount | null = null;

function Sibling(): null {
  useTelemetry("vessel.flight");
  useTelemetry("vessel.identity");
  useTelemetry("trackingStation.bodies");
  return null;
}

function Gate({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  reveal = () => setOpen(true);
  return open ? <>{children}</> : <Sibling />;
}

function frames(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

const scene: LateScene = {
  async mount({ w, h, flownSeconds = FLOWN_SECONDS }) {
    mounted?.unmount();
    const root = document.getElementById("root");
    if (!root) throw new Error("ground-track-late: #root missing");
    const ut = fixture._stream.pinnedUt;
    const flight = fixture._stream.emits.find(
      (e) => e.channel === "vessel.flight",
    )?.value as Record<string, unknown>;
    const before = { validAt: ut - flownSeconds - 10, deliveredAt: ut };
    const emits = fixture._stream.emits
      .filter((e) => e.channel !== "vessel.flight")
      .map((e) => ({ ...e, meta: { ...e.meta, ...before } }));
    const payload = probePayload({
      widgetId: "ground-track",
      fixture: { ...fixture, _stream: { pinnedUt: ut, emits } },
      size: { w, h },
    });
    mounted = mountProbe(root, payload, {
      wrap: (tree) => <Gate>{tree}</Gate>,
    });
    await mounted.ready;
    const longitude = flight.longitude as number;
    for (let ago = flownSeconds; ago >= 0; ago--) {
      mounted.emit(
        "vessel.flight",
        { ...flight, longitude: longitude - ago * DEGREES_PER_SECOND },
        { validAt: ut - ago, deliveredAt: ut },
      );
    }
    mounted.scrubTo(ut);
    await frames();
  },
  async openMap() {
    reveal();
    await frames();
    await frames();
    await new Promise((resolve) => setTimeout(resolve, 600));
  },
};

declare global {
  interface Window {
    __lateScene: LateScene;
  }
}

window.__lateScene = scene;
