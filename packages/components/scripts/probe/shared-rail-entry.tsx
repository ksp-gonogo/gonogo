/**
 * Two screens of one command centre side by side, a main screen and a station,
 * each the real widget on its own stream, with one queue between them: a press
 * on either screen is put on both screens' `system.uplink.pending`, as the mod
 * sends it to every screen at that centre. The driver is `render-shared-rail`.
 */
import type { Meta } from "@ksp-gonogo/sitrep-sdk";
import { probePayload } from "./payload";
import { mountProbe, type ProbeMount } from "./probe-entry";

const T0 = 350296488.3;
/** One-way delay in seconds, 27.4 unless `mount` names another. */
let delay = 27.4;
const VANTAGE = "ground:Kerbin: KSC";

const GROUPS = Array.from({ length: 10 }, (_, i) => ({
  index: i + 1,
  name: `AG${i + 1}`,
  state: false,
}));

const CONTROL = {
  sas: false,
  sasMode: 0,
  rcs: false,
  precisionControl: false,
  gear: false,
  brakes: false,
  lights: false,
  throttle: 0,
  actionGroups: GROUPS,
};

function instruments(state: "unused" | "holding" | "sent") {
  return [
    {
      partId: "77",
      partName: "Mystery Goo Containment Unit",
      experimentId: "mysteryGoo",
      title: "Mystery Goo Observation",
      deployed: state !== "unused",
      inoperable: false,
      rerunnable: false,
      resettable: false,
      dataIsCollectable: state === "holding",
      holdsData: state === "holding",
      subjectId: state === "holding" ? "mysteryGoo@KerbinInSpaceLow" : null,
      science: state === "holding" ? 10 : null,
      scienceCap: 10,
    },
  ];
}

export type SharedWidget = "navball" | "action-group" | "experiments";
/** What the Experiments card starts with: an unused Mystery Goo, or one holding data to transmit. */
export type ExperimentsScenario = "deploy" | "transmit";
export type SharedScreen = "main" | "station";
export type SharedStep =
  | "press"
  | "accept"
  | "travel"
  | "hold"
  | "throttle"
  | "warn"
  | "grow"
  | "later"
  | "overdue";

export interface SharedScene {
  mount(opts: {
    widget: SharedWidget;
    w: number;
    h: number;
    pxW: number;
    delaySeconds?: number;
    scenario?: ExperimentsScenario;
  }): Promise<void>;
  /** Plays `step` with `from` as the screen the operator pressed on. */
  step(step: SharedStep, from: SharedScreen): Promise<void>;
  /** Each screen's toggle text, or null where none is drawn. */
  toggles(): Record<SharedScreen, string | null>;
  /** Moves both screens' game clock to `seconds` after the scene began. */
  at(seconds: number): void;
  /**
   * The craft answers every held command: the queue empties. `"done"` flips the
   * toggle in the readings; `"refused"` answers with a refusal and leaves the
   * readings as they were.
   */
  answer(outcome?: "done" | "refused"): void;
  /** Puts the link between the command centre and the craft up or down, from now on. */
  link(up: boolean): void;
  /** Presses the named toggle on `from`, has the mod accept it, and puts it on the queue. */
  pressAndSend(from: SharedScreen, name: SharedToggle): void;
  /** The relay's report on the held command reaches the centre: that it is held, or that it has left. */
  report(kind: "held" | "departed"): void;
  /** Writes `text` in the caption bar above both screens. */
  caption(text: string): void;
}

const mounts: Partial<Record<SharedScreen, ProbeMount>> = {};
let widget: SharedWidget = "navball";
const SCREENS: readonly SharedScreen[] = ["main", "station"];

function frames(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

function host(screen: SharedScreen): HTMLElement {
  const el = document.getElementById(`screen-${screen}`);
  if (!el) throw new Error(`shared-rail: no ${screen} screen`);
  return el;
}

function stream(screen: SharedScreen) {
  const s = mounts[screen]?.stream();
  if (!s) throw new Error(`shared-rail: ${screen} not mounted`);
  return s;
}

/** Seconds of game time since the scene began. */
let now = 0;
let linkUp = true;

function emitBoth(topic: string, payload: unknown, ut = T0 + now): void {
  const meta: Partial<Meta> = { validAt: ut - delay, deliveredAt: ut };
  for (const screen of SCREENS) stream(screen).emit(topic, payload, meta);
}

/** Moves both screens' game clock to `T0 + seconds`, so a command sent at T0 is drawn partway along the rail. */
function advance(seconds: number): void {
  now = seconds;
  const ut = T0 + seconds;
  for (const screen of SCREENS) stream(screen).scrubTo(ut);
  emitBoth("comms.link", { connected: linkUp }, ut);
}

/** The Navball toggles a scene can press, by the word their label starts with. */
export type SharedToggle = "RCS" | "SAS" | "PRECISION";

let scenario: ExperimentsScenario = "deploy";

function toggleOn(
  screen: SharedScreen,
  name: SharedToggle = "RCS",
): HTMLButtonElement | null {
  if (widget === "experiments") {
    const word = scenario === "deploy" ? "Deploy" : "Transmit";
    const found = Array.from(host(screen).querySelectorAll("button")).find(
      (b) =>
        b.textContent?.trim() === word ||
        b.textContent?.trim() === `Confirm ${word.toLowerCase()}` ||
        b.getAttribute("aria-label") ===
          `${word === "Deploy" ? "Deploying..." : "Transmitting..."}`,
    );
    return (found as HTMLButtonElement | undefined) ?? null;
  }
  const found = Array.from(host(screen).querySelectorAll("button")).find((b) =>
    widget === "navball"
      ? new RegExp(`^${name}`).test(b.textContent ?? "")
      : b.getAttribute("aria-label") === "Toggle Light",
  );
  return (found as HTMLButtonElement | undefined) ?? null;
}

/** Which toggles are pressed and waiting for their reply, to flip in the readings when it comes. */
const pressed = new Map<SharedToggle, number>();
const press = (name: SharedToggle) =>
  pressed.set(name, (pressed.get(name) ?? 0) + 1);
const flipped: Record<SharedToggle, boolean> = {
  RCS: false,
  SAS: false,
  PRECISION: false,
};

/** The relay's reports, as they have reached the centre. */
let journeyEvents: Record<string, unknown>[] = [];

function click(screen: SharedScreen, selector: string): void {
  const el = host(screen).querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`shared-rail: no ${selector} on ${screen}`);
  el.click();
}

function buttonByText(screen: SharedScreen, text: string): HTMLButtonElement {
  const found = Array.from(host(screen).querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!found) throw new Error(`shared-rail: no ${text} on ${screen}`);
  return found as HTMLButtonElement;
}

let pending: Record<string, unknown>[] = [];
let settled: Record<string, unknown>[] = [];

function queueEntry(
  from: SharedScreen,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const sent = stream(from).transport.sentCommands.at(-1);
  if (!sent) throw new Error(`shared-rail: ${from} sent nothing`);
  return {
    id: `engine-${pending.length + 1}`,
    clientRequestId: sent.requestId,
    command: sent.command,
    label: sent.label ?? "",
    topic: "",
    vantage: VANTAGE,
    dispatchedAt: T0 + now,
    oneWaySeconds: delay,
    ...extra,
  };
}

/** Seconds a held command waits at the relay before it goes on. */
const HOLD_SECONDS = 12;
/** Light-time from the command centre to the relay, in seconds; the rest of the delay is the way on to the craft. */
const TO_RELAY_SECONDS = 4;

function held() {
  return {
    laneSeq: 1,
    craft: "vessel:abc",
    predictedHeldAt: "relay-1",
    // Deleted wherever it is if it has not run within the hour, as the mod sends it.
    expiresAtUt: T0 + now + 3600,
    predictedHeldFromUt: T0 + now + TO_RELAY_SECONDS,
    predictedHeldUntilUt: T0 + now + HOLD_SECONDS,
    predictedArrivalUt: T0 + now + HOLD_SECONDS + (delay - TO_RELAY_SECONDS),
    predictedReplyUt:
      T0 + now + HOLD_SECONDS + (delay - TO_RELAY_SECONDS) + delay,
  };
}

const WARNING =
  "A continuous input is lost if it has to wait, and this centre's plan says it would wait at Duna Relay. Fly this from a pilot aboard or leave it to automation on the craft.";

/** The toggle's state in the readings, flipped by each answered press. */
let on = false;

const scene: SharedScene = {
  async mount(opts) {
    for (const screen of SCREENS) mounts[screen]?.unmount();
    pending = [];
    settled = [];
    journeyEvents = [];
    pressed.clear();
    flipped.RCS = false;
    flipped.SAS = false;
    flipped.PRECISION = false;
    now = 0;
    on = false;
    linkUp = true;
    delay = opts.delaySeconds ?? 27.4;
    widget = opts.widget;
    scenario = opts.scenario ?? "deploy";
    const root = document.getElementById("root");
    if (!root) throw new Error("shared-rail: #root missing");
    root.style.background = "#0b0d0f";
    root.style.padding = "12px";
    root.innerHTML = `<div id="caption" style="display:none;font:600 14px sans-serif;color:#e8eef0;padding:0 0 10px;min-height:38px;max-width:${2 * opts.pxW + 16}px"></div><div style="display:flex;gap:16px">${SCREENS.map(
      (screen) =>
        `<div style="width:${opts.pxW}px"><div style="font:600 12px sans-serif;color:#9aa;padding:0 0 6px">${
          screen === "main" ? "Main screen" : "Station"
        }</div><div id="screen-${screen}"></div></div>`,
    ).join("")}</div>`;
    const meta = { validAt: T0 - delay, deliveredAt: T0 };
    for (const screen of SCREENS) {
      const payload = probePayload({
        widgetId: opts.widget,
        fixture: {
          _stream: {
            pinnedUt: T0,
            emits: [
              { channel: "comms.link", value: { connected: true }, meta },
              {
                channel: "comms.delay",
                value: { oneWaySeconds: delay, source: 1 },
                meta,
              },
              { channel: "vessel.control", value: CONTROL, meta },
              ...(opts.widget === "experiments"
                ? [
                    { channel: "science.experiments", value: [], meta },
                    {
                      channel: "science.instruments",
                      value: instruments(
                        scenario === "deploy" ? "unused" : "holding",
                      ),
                      meta,
                    },
                  ]
                : []),
            ],
          },
        },
        size: {
          w: opts.w,
          h: opts.h,
          config:
            opts.widget === "action-group"
              ? { actionGroupId: "Light" }
              : opts.widget === "experiments"
                ? {}
                : { controlMode: true },
        },
      });
      const mounted = mountProbe(host(screen), payload);
      mounts[screen] = mounted;
      await mounted.ready;
      const s = stream(screen);
      s.transport.holdCommands();
      s.transport.setCommandHandler(() => ({ success: true }));
    }
    await frames();
  },
  async step(step, from) {
    const s = stream(from);
    switch (step) {
      case "press":
        press("RCS");
        toggleOn(from)?.click();
        await frames();
        // Transmit asks for a confirming press.
        if (widget === "experiments" && scenario === "transmit") {
          toggleOn(from)?.click();
          await frames();
        }
        break;
      case "accept": {
        const sent = s.transport.sentCommands.at(-1);
        if (sent) {
          s.transport.emitRaw({
            type: "command-accepted",
            requestId: sent.requestId,
            oneWaySeconds: delay,
          });
        }
        break;
      }
      case "travel":
        pending = [...pending, queueEntry(from, {})];
        emitBoth("system.uplink.pending", { pending });
        break;
      case "hold": {
        // The mod accepts a held command with the time it is held for, and its reply when that is over.
        const sent = s.transport.sentCommands.at(-1);
        const plan = held();
        if (sent) {
          s.transport.emitRaw({
            type: "command-accepted",
            requestId: sent.requestId,
            oneWaySeconds: plan.predictedArrivalUt - (T0 + now),
            predictedReplyUt: plan.predictedReplyUt,
          });
        }
        pending = [...pending, queueEntry(from, plan)];
        emitBoth("system.uplink.pending", { pending });
        break;
      }
      case "throttle": {
        click(from, 'button[aria-label="Throttle controls"]');
        await frames();
        buttonByText(from, "FULL").click();
        await new Promise((resolve) => setTimeout(resolve, 350));
        pending = [...pending, { ...queueEntry(from, {}), commandedValue: 1 }];
        emitBoth("system.uplink.pending", { pending });
        // A second at a time, so each screen's recorder draws the input as a line rather than a point.
        const from0 = now;
        for (let s = 1; s <= 12; s += 1) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          advance(from0 + s);
        }
        break;
      }
      case "warn": {
        const sent = s.transport.sentCommands.at(-1);
        if (sent) {
          s.transport.emitRaw({
            type: "command-accepted",
            requestId: sent.requestId,
            warning: WARNING,
          });
          // The mod writes the same sentence on the input's queue entry, which every screen at the centre reads.
          pending = pending.map((e) =>
            e.clientRequestId === sent.requestId
              ? {
                  ...e,
                  oneWaySeconds: null,
                  predictedHeldAt: "relay-1",
                  predictedReplyUt: T0 + now + 2 * delay,
                  warning: WARNING,
                }
              : e,
          );
          emitBoth("system.uplink.pending", { pending });
        }
        break;
      }
      case "later":
        advance(now + 12);
        break;
      case "overdue":
        // The sending centre has found the reply overdue, and writes so on the entry.
        pending = pending.map((e) => ({ ...e, replyOverdueUt: T0 + now }));
        emitBoth("system.uplink.pending", { pending });
        break;
      case "grow":
        for (const screen of SCREENS) {
          host(screen)
            .querySelector<HTMLElement>(
              'button[aria-label="Signal-delay detail"]',
            )
            ?.click();
        }
        break;
    }
    await frames();
    await frames();
  },
  at(seconds) {
    advance(seconds);
  },
  answer(outcome = "done") {
    for (const screen of SCREENS) {
      const t = stream(screen).transport;
      t.setCommandHandler(() =>
        outcome === "refused"
          ? { success: false, errorCode: "modeUnavailable" }
          : { success: true },
      );
      t.answerHeldCommands();
      t.holdCommands();
    }
    // The centre lists a refused command's outcome on the queue, which every screen at it reads.
    // A refusal is listed for every screen, and so is an answer that came after the centre found it overdue.
    const listed =
      outcome === "refused"
        ? pending
        : pending.filter((e) => e.replyOverdueUt != null);
    settled =
      listed.length > 0
        ? [
            ...settled,
            ...listed.map((e) => ({
              id: e.id,
              clientRequestId: e.clientRequestId,
              command: e.command,
              label: e.label,
              topic: e.topic,
              vantage: e.vantage,
              settledAt: T0 + now,
              outcome: outcome === "refused" ? "refused" : "answered",
              code: outcome === "refused" ? "modeUnavailable" : "",
            })),
          ]
        : settled;
    pending = [];
    emitBoth("system.uplink.pending", { pending, settled });
    if (outcome === "done") {
      on = !on;
      for (const [name, times] of pressed) {
        if (times % 2 === 1) flipped[name] = !flipped[name];
      }
    }
    pressed.clear();
    if (widget === "experiments") {
      if (outcome === "done") {
        emitBoth(
          "science.instruments",
          instruments(scenario === "deploy" ? "holding" : "sent"),
        );
      }
      return;
    }
    emitBoth(
      "vessel.control",
      widget === "navball"
        ? {
            ...CONTROL,
            rcs: flipped.RCS,
            sas: flipped.SAS,
            precisionControl: flipped.PRECISION,
          }
        : { ...CONTROL, lights: on },
    );
  },
  pressAndSend(from, name) {
    press(name);
    toggleOn(from, name)?.click();
    const s = stream(from);
    const sent = s.transport.sentCommands.at(-1);
    if (sent) {
      s.transport.emitRaw({
        type: "command-accepted",
        requestId: sent.requestId,
        oneWaySeconds: delay,
      });
    }
    pending = [...pending, queueEntry(from, {})];
    emitBoth("system.uplink.pending", { pending, settled });
  },
  report(kind) {
    // What the relay says of the held command, landing at the centre as light carries it home.
    const entry = pending.find((e) => e.predictedHeldAt != null);
    if (!entry) return;
    const from = entry.predictedHeldFromUt as number;
    const until = entry.predictedHeldUntilUt as number;
    const arrival = entry.predictedArrivalUt as number;
    journeyEvents = [
      ...journeyEvents,
      kind === "held"
        ? {
            id: `${entry.id}-held`,
            about: entry.id,
            craft: "vessel:abc",
            laneSeq: 1,
            kind: 0,
            at: "relay-1",
            atUt: from,
            untilUt: until,
            missing: [],
          }
        : {
            id: `${entry.id}-departed`,
            about: entry.id,
            craft: "vessel:abc",
            laneSeq: 1,
            kind: 1,
            at: "relay-1",
            atUt: until,
            untilUt: arrival,
            missing: [],
          },
    ];
    emitBoth("comms.journey", { epoch: 0, events: journeyEvents });
  },
  link(up) {
    linkUp = up;
    advance(now);
  },
  caption(text) {
    const el = document.getElementById("caption");
    if (!el) return;
    el.textContent = text;
    el.style.display = text ? "" : "none";
  },
  toggles() {
    return {
      main: toggleOn("main")?.textContent ?? null,
      station: toggleOn("station")?.textContent ?? null,
    };
  },
};

declare global {
  interface Window {
    __sharedScene: SharedScene;
  }
}

window.__sharedScene = scene;
