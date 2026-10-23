/**
 * A scene for the Action Group's Light toggle through one press: idle, sent,
 * accepted by the mod, travelling at the game's signal delay, answered,
 * confirmed by the craft's readings, unconfirmed, and refused. It mounts the
 * real widget through the widget probe's own mount and plays the command's
 * life through the scene's stub transport. The driver is
 * `render-pending-confirm`.
 */
import type { Meta } from "@ksp-gonogo/sitrep-sdk";
import { probePayload } from "./payload";
import { mountProbe, type ProbeMount } from "./probe-entry";

const T0 = 350296488.3;

const GROUPS = Array.from({ length: 10 }, (_, i) => ({
  index: i + 1,
  name: `AG${i + 1}`,
  state: false,
}));

function control(lights: boolean) {
  return {
    sas: false,
    sasMode: 0,
    rcs: false,
    gear: false,
    brakes: false,
    lights,
    throttle: 0,
    actionGroups: GROUPS,
  };
}

export interface PendingScene {
  /** Mounts a fresh Light toggle at `w` by `h`, the light on, over a one-way delay of `delay` seconds; `refuse` has the craft refuse the press. */
  mount(opts: {
    w: number;
    h: number;
    delay: number;
    refuse?: boolean;
  }): Promise<void>;
  /** Plays the scene forward to the named state. */
  step(state: PendingStep): Promise<void>;
  /** The toggle button's box and text, to compare between states. */
  button(): {
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
  };
}

export type PendingStep =
  | "sent"
  | "accepted"
  | "travelling"
  | "answered"
  | "confirmed"
  | "unconfirmed";

let mounted: ProbeMount | null = null;
let delay = 0;

function stream() {
  const s = mounted?.stream();
  if (!s) throw new Error("pending-confirm: nothing mounted");
  return s;
}

/** Emits `payload` sent at the craft `delay` seconds before it is delivered at `ut`, which is what moves the clock the command is judged against. */
function at(ut: number, topic: string, payload: unknown): void {
  const meta: Partial<Meta> = { validAt: ut - delay, deliveredAt: ut };
  stream().emit(topic, payload, meta);
}

function frames(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

function toggle(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Toggle Light"]',
  );
  if (!button) throw new Error("pending-confirm: no Light toggle");
  return button;
}

const scene: PendingScene = {
  async mount(opts) {
    mounted?.unmount();
    delay = opts.delay;
    const root = document.getElementById("root");
    if (!root) throw new Error("pending-confirm: #root missing");
    const meta = { validAt: T0 - delay, deliveredAt: T0 };
    const payload = probePayload({
      widgetId: "action-group",
      fixture: {
        _stream: {
          emits: [
            { channel: "comms.link", value: { connected: true }, meta },
            {
              channel: "comms.delay",
              value: { oneWaySeconds: delay, source: 1 },
              meta,
            },
            { channel: "vessel.control", value: control(true), meta },
          ],
        },
      },
      size: { w: opts.w, h: opts.h, config: { actionGroupId: "Light" } },
    });
    mounted = mountProbe(root, payload);
    await mounted.ready;
    const s = stream();
    s.transport.holdCommands();
    s.transport.setCommandHandler(() =>
      opts.refuse
        ? {
            success: false,
            errorCode: "E_MODE_UNAVAILABLE",
            reason: "The lights are locked.",
          }
        : { success: true },
    );
    await frames();
  },
  async step(state) {
    const s = stream();
    switch (state) {
      case "sent": {
        toggle().click();
        await frames();
        const [sent] = s.transport.sentCommands;
        if (delay > 0) {
          at(T0, "system.uplink.pending", {
            pending: [
              {
                id: "engine-1",
                clientRequestId: sent.requestId,
                command: "vessel.control.setLights",
                label: "Toggle Light",
                topic: "",
                vantage: "ground:Kerbin: KSC",
                dispatchedAt: T0,
                oneWaySeconds: delay,
              },
            ],
          });
        }
        break;
      }
      case "accepted": {
        const [sent] = s.transport.sentCommands;
        s.transport.emitRaw({
          type: "command-accepted",
          requestId: sent.requestId,
          oneWaySeconds: delay,
        });
        at(T0 + 1, "vessel.control", control(true));
        break;
      }
      case "travelling":
        at(T0 + delay * 1.5, "vessel.control", control(true));
        break;
      case "answered":
        at(T0 + 2 * delay + 0.3, "system.uplink.pending", { pending: [] });
        at(T0 + 2 * delay + 0.3, "vessel.control", control(true));
        s.transport.answerHeldCommands();
        break;
      case "confirmed":
        at(T0 + 2 * delay + 8, "vessel.control", control(false));
        break;
      case "unconfirmed":
        at(T0 + 2 * delay + 61, "vessel.control", control(true));
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
    __pendingScene: PendingScene;
  }
}

window.__pendingScene = scene;
