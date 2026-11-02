/**
 * A scene for the Navball's RCS toggle and the Action Group's Light toggle
 * through one press at a delay: idle, pending, held for a link, and answered.
 * It mounts the real widget through the widget probe's own mount and plays the
 * command's life through the scene's stub transport. The driver is
 * `render-held-toggles`.
 */
import type { Meta } from "@ksp-gonogo/sitrep-sdk";
import { probePayload } from "./payload";
import { mountProbe, type ProbeMount } from "./probe-entry";

const T0 = 350296488.3;
const DELAY = 27.4;

const GROUPS = Array.from({ length: 10 }, (_, i) => ({
  index: i + 1,
  name: `AG${i + 1}`,
  state: false,
}));

function control(on: boolean) {
  return {
    sas: false,
    sasMode: 0,
    rcs: on,
    precisionControl: false,
    gear: false,
    brakes: false,
    lights: on,
    throttle: 0,
    actionGroups: GROUPS,
  };
}

export type HeldWidget = "navball" | "action-group";
export type HeldStep = "pending" | "held" | "answered";

export interface HeldScene {
  mount(opts: { widget: HeldWidget; w: number; h: number }): Promise<void>;
  step(state: HeldStep): Promise<void>;
  /** The toggle button's box and text. */
  button(): {
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
  };
}

let mounted: ProbeMount | null = null;
let widget: HeldWidget = "navball";

function stream() {
  const s = mounted?.stream();
  if (!s) throw new Error("held-toggles: nothing mounted");
  return s;
}

function at(ut: number, topic: string, payload: unknown): void {
  const meta: Partial<Meta> = { validAt: ut - DELAY, deliveredAt: ut };
  stream().emit(topic, payload, meta);
}

function frames(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

function toggle(): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find((b) =>
    widget === "navball"
      ? /^RCS/.test(b.textContent ?? "")
      : b.getAttribute("aria-label") === "Toggle Light",
  );
  if (!found) throw new Error("held-toggles: no toggle");
  return found as HTMLButtonElement;
}

const scene: HeldScene = {
  async mount(opts) {
    mounted?.unmount();
    widget = opts.widget;
    const root = document.getElementById("root");
    if (!root) throw new Error("held-toggles: #root missing");
    const meta = { validAt: T0 - DELAY, deliveredAt: T0 };
    const payload = probePayload({
      widgetId: opts.widget,
      fixture: {
        _stream: {
          emits: [
            { channel: "comms.link", value: { connected: true }, meta },
            {
              channel: "comms.delay",
              value: { oneWaySeconds: DELAY, source: 1 },
              meta,
            },
            {
              channel: "vessel.control",
              value: control(opts.widget === "action-group"),
              meta,
            },
          ],
        },
      },
      size: {
        w: opts.w,
        h: opts.h,
        config:
          opts.widget === "action-group" ? { actionGroupId: "Light" } : {},
      },
    });
    mounted = mountProbe(root, payload);
    await mounted.ready;
    const s = stream();
    s.transport.holdCommands();
    s.transport.setCommandHandler(() => ({ success: true }));
    await frames();
  },
  async step(state) {
    const s = stream();
    const command =
      widget === "navball"
        ? "vessel.control.setRcs"
        : "vessel.control.setLights";
    const label = widget === "navball" ? "Toggle RCS" : "Toggle Light";
    const entry = (extra: Record<string, unknown>) => {
      const [sent] = s.transport.sentCommands;
      return {
        pending: [
          {
            id: "engine-1",
            clientRequestId: sent.requestId,
            command,
            label,
            topic: "",
            vantage: "ground:Kerbin: KSC",
            dispatchedAt: T0,
            oneWaySeconds: DELAY,
            ...extra,
          },
        ],
      };
    };
    switch (state) {
      case "pending":
        toggle().click();
        await frames();
        at(T0, "system.uplink.pending", entry({}));
        break;
      case "held":
        toggle().click();
        await frames();
        at(
          T0,
          "system.uplink.pending",
          entry({
            laneSeq: 1,
            craft: "vessel:abc",
            predictedHeldAt: "relay-1",
            predictedHeldUntilUt: T0 + 500,
            predictedArrivalUt: T0 + 527,
            predictedReplyUt: T0 + 554,
          }),
        );
        break;
      case "answered":
        at(T0 + 2 * DELAY + 0.3, "system.uplink.pending", { pending: [] });
        at(
          T0 + 2 * DELAY + 0.3,
          "vessel.control",
          control(widget === "navball"),
        );
        s.transport.answerHeldCommands();
        break;
    }
    await frames();
    await frames();
  },
  button() {
    const button = toggle();
    const box = button.getBoundingClientRect();
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      text: button.textContent ?? "",
    };
  },
};

declare global {
  interface Window {
    __heldScene: HeldScene;
  }
}

window.__heldScene = scene;
