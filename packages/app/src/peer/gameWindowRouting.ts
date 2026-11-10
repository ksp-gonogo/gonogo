import type { PeerMessage } from "./protocol";

export const GAME_WINDOWS_TOPIC = "vessel.gameWindows";

/** The commands whose press can open a window on the game's screen. */
export const WINDOW_OPENING_COMMANDS: ReadonlySet<string> = new Set([
  "vessel.gameWindow.press",
  "vessel.invokePartAction",
]);

/** The windows a `vessel.gameWindows` payload lists, or `undefined` when it is not a window list. */
function windowsOf(payload: unknown): unknown[] | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  if (!("windows" in payload) || !Array.isArray(payload.windows)) {
    return undefined;
  }
  return payload.windows;
}

/** The id of the press that opened a listed window, or `undefined` when it names none. */
function pressIdOf(window: unknown): string | undefined {
  if (typeof window !== "object" || window === null) return undefined;
  if (!("openedBy" in window)) return undefined;
  const opener = window.openedBy;
  if (typeof opener !== "object" || opener === null) return undefined;
  if (!("pressId" in opener) || typeof opener.pressId !== "string") {
    return undefined;
  }
  return opener.pressId;
}

/**
 * Narrows a relayed `vessel.gameWindows` frame to the windows whose press the
 * station sent, or `undefined` when the frame is not that Topic's data and goes
 * through as it is. A frame of that Topic whose payload is not a window list is
 * withheld (an empty list), never passed on whole.
 */
export function windowsSentTo(
  msg: PeerMessage,
  pressIds: ReadonlySet<string>,
): PeerMessage | undefined {
  if (msg.type !== "sitrep-frame") return undefined;
  const frame = msg.message;
  if (frame.type !== "stream-data" || frame.topic !== GAME_WINDOWS_TOPIC) {
    return undefined;
  }
  const kept = (windowsOf(frame.payload) ?? []).filter((window) => {
    const pressId = pressIdOf(window);
    return pressId !== undefined && pressIds.has(pressId);
  });
  return { ...msg, message: { ...frame, payload: { windows: kept } } };
}

/**
 * Whether the host's own screen draws a window: one opened by a press that has
 * an id, and that no station sent. A window with no press behind it is drawn
 * nowhere.
 */
export function hostShowsWindow(
  pressId: string | undefined,
  isStationPress: (pressId: string) => boolean,
): boolean {
  return !!pressId && !isStationPress(pressId);
}
