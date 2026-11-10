/**
 * Game-window mirror probe entry: a review-render driver for a part's game
 * window opened as a form on the dashboard (see `render-game-window-mirror.ts`).
 * One screen per page: the real kit dialog around the real `GameWindowForm`,
 * over its own stream, fed the frames the mod sends. The windows the screen is
 * sent are chosen by the host's own routing function.
 */

import { installTestHost } from "@ksp-gonogo/sitrep-sdk/testing";
import {
  defaultDarkTheme,
  LockScope,
  ModalProvider,
  useModal,
} from "@ksp-gonogo/ui-kit";
import { createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "styled-components";
import {
  hostShowsWindow,
  windowsSentTo,
} from "../../../app/src/peer/gameWindowRouting";
import { gameWindowFallback } from "../../src/PartPanels/GameWindowPanel";
import { GameWindowAudienceContext } from "../../src/PartPanels/gameWindowAudience";
import { setupStreamFixture } from "../../src/test/setupStreamFixture";

const START = performance.now();
installTestHost({
  useViewClockOptional: () => ({
    utNowEstimate: () => 100 + (performance.now() - START) / 1000,
    confirmedEdgeUt: () => 100,
    onFrame: () => () => {},
  }),
});

const PART_ID = "7";
const PART_TITLE = "Mk1 Command Pod";
const BUTTON = {
  module: "ModuleCommand",
  event: "RenameVessel",
  label: "Rename Vessel",
};

interface ScreenSpec {
  /** The ids of the presses this screen sent, which decide the windows it is sent. */
  presses: string[];
  /** The press ids stations sent, which the host's own screen leaves out. */
  stationPresses: string[];
  /** Whether the screen is the host's own. */
  isHost: boolean;
  /** Send every window to the screen whatever opened it, as the mirror alone did. */
  unfiltered: boolean;
  delaySeconds: number;
}

const windowOf = (id: string, pressId: string) => ({
  id,
  technology: "ugui",
  title: "Rename Vessel",
  openedBy: {
    partId: PART_ID,
    module: BUTTON.module,
    event: BUTTON.event,
    label: BUTTON.label,
    pressId,
  },
  root: {
    id: "w",
    kind: "group",
    dir: "v",
    children: [
      { id: "w/label0", kind: "label", text: "Vessel name" },
      { id: "w/input0", kind: "textfield", text: "Untitled Space Craft" },
      {
        id: "w/group0",
        kind: "group",
        dir: "h",
        children: [
          { id: "w/button0:Accept", kind: "button", text: "Accept" },
          { id: "w/button0:Cancel", kind: "button", text: "Cancel" },
        ],
      },
    ],
  },
});

let fixture: ReturnType<typeof setupStreamFixture> | undefined;

/* Each queue frame is a later one than the last, as the mod's are, so none is taken for a repeat. */
let queueSeq = 0;
const emitQueue = (payload: unknown) =>
  fixture?.emit("system.uplink.pending", payload, {
    validAt: 99 + ++queueSeq * 0.001,
  });
let spec: ScreenSpec | undefined;

function OpenThePanel() {
  const { open } = useModal();
  useEffect(() => {
    const panel = gameWindowFallback(BUTTON);
    if (!panel) throw new Error("no panel");
    const Content = panel.component;
    open(
      <LockScope>
        <Content partId={PART_ID} partTitle={PART_TITLE} close={() => {}} />
      </LockScope>,
      {
        title: `${panel.title} · ${PART_TITLE}`,
        titleAdornment: panel.titleAdornment,
        width: panel.width,
      },
    );
  }, [open]);
  return null;
}

function mount(next: ScreenSpec) {
  const root = document.getElementById("root");
  if (!root) throw new Error("no root");
  spec = next;
  const current = setupStreamFixture({
    pinnedUt: 100,
    delaySeconds: next.delaySeconds,
  });
  fixture = current;
  const stations = new Set(next.stationPresses);
  const audience = next.unfiltered
    ? () => true
    : next.isHost
      ? (id: string) => hostShowsWindow(id, (p) => stations.has(p))
      : () => true;
  createRoot(root).render(
    createElement(
      ThemeProvider,
      { theme: defaultDarkTheme },
      <current.Provider>
        <GameWindowAudienceContext.Provider value={audience}>
          <ModalProvider>
            <OpenThePanel />
          </ModalProvider>
        </GameWindowAudienceContext.Provider>
      </current.Provider>,
    ),
  );
}

/** Sends the mod's frame to this screen through the host's routing, as the relay does. */
async function modSends(windows: unknown[]) {
  if (!fixture || !spec) return;
  const frame = {
    type: "sitrep-frame",
    message: {
      type: "stream-data",
      topic: "vessel.gameWindows",
      payload: { windows },
      meta: { validAt: 100 },
    },
  } as never;
  const routed =
    spec.unfiltered || spec.isHost
      ? frame
      : windowsSentTo(frame, new Set(spec.presses));
  const message = (routed as unknown as { message: { payload: unknown } })
    .message;
  fixture.emit("vessel.gameWindows", message.payload);
  await new Promise((resolve) => setTimeout(resolve, 120));
}

function modPending(label: string) {
  emitQueue({
    pending: [
      {
        id: "press-1",
        clientRequestId: "press-1",
        command: "vessel.invokePartAction",
        label,
        topic: "",
        vantage: "ground:Kerbin: KSC",
        dispatchedAt: 0,
        oneWaySeconds: 30,
      },
    ],
  });
}

function modPendingClear(settled = false) {
  emitQueue({
    pending: [],
    settled: settled
      ? [
          {
            id: "press-1",
            clientRequestId: "press-1",
            command: "vessel.invokePartAction",
            label: "Rename Vessel on Mk1 Command Pod",
            topic: "",
            vantage: "ground:Kerbin: KSC",
            settledAt: 60,
            outcome: "confirmed",
          },
        ]
      : [],
  });
}

/** The mod accepts the last press the form sent and lists it on the command centre's queue. */
function modAcceptsLastPress(label: string) {
  if (!fixture) return;
  const presses = fixture.transport.sentCommands.filter(
    (c) => c.command === "vessel.gameWindow.press",
  );
  const press = presses[presses.length - 1];
  if (!press) return;
  fixture.transport.emitRaw({
    type: "command-accepted",
    requestId: press.requestId,
    oneWaySeconds: 30,
  });
  emitQueue({
    pending: [
      {
        id: "engine-1",
        clientRequestId: press.requestId,
        command: "vessel.gameWindow.press",
        label,
        topic: press.topic,
        vantage: "ground:Kerbin: KSC",
        dispatchedAt: 0,
        oneWaySeconds: 30,
      },
    ],
  });
}

Object.assign(window, {
  __mount: mount,
  __modSends: modSends,
  __windowOf: windowOf,
  __modPending: modPending,
  __modPendingClear: modPendingClear,
  __modAcceptsLastPress: modAcceptsLastPress,
});
