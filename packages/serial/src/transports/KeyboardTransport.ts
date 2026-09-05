// KeyboardTransport: the operator's own keyboard as a DeviceTransport.
//
// The one transport with nothing to pair, nothing to authorise and nothing to
// declare: the key table is code-defined (see ../keyboardKeys.ts) and the
// service seeds one instance per screen, so an operator binds a key by opening
// a widget's Inputs tab, pressing Bind, and pressing the key.
//
// It listens on `window` in the BUBBLE phase and never calls
// `preventDefault()` or `stopPropagation()`. A global handler that swallowed
// keys would take Tab, Enter and Space away from whatever control has focus,
// which is the page's own keyboard operation; this one only observes. Three
// rules keep an observed key from ALSO firing an action when the operator
// meant it for the page:
//
//   1. Text entry wins. A key typed into an input, textarea, select or
//      contenteditable emits nothing.
//   2. Enter and Space belong to a focused control. Both activate a button,
//      link or checkbox, so while one of those has focus neither key emits.
//      Every other key still does.
//   3. Ctrl, Meta and Alt mark a browser or OS shortcut, not an action. A key
//      pressed while one of them is held emits nothing. The modifiers
//      themselves ARE bindable: pressing Ctrl alone emits `ControlLeft`,
//      because that is a key press and not a chord. There are no chords.
//
// Rule 2 is also why this file does not contradict the radio push-to-talk
// key, which is a latch rather than hold-to-talk precisely because a `<button>`
// cannot hear a reliable Space/Enter `keyup`. Nothing here changes what a
// focused button does with either key.
//
// Two more decisions the browser forces:
//   - KEY REPEAT is dropped (`event.repeat`). Holding a key would otherwise
//     dispatch the bound action at the OS autorepeat rate, which for a staging
//     or abort action is a fair description of a disaster.
//   - A KEY HELD ACROSS A BLUR never delivers its `keyup`: the window that
//     receives it is somebody else's. So a blur (and a tab going hidden)
//     releases every held key, emitting `false` for each. Without that, an
//     action bound to a held key would stay latched on forever.
import { PerfBudget } from "@ksp-gonogo/core";
import { isKeyboardInputCode } from "../keyboardKeys";
import type {
  DeviceTransport,
  InputEvent,
  TransportStatus,
} from "./DeviceTransport";

/**
 * Fast typing tops out around 15 keys/sec, and each key is one press plus one
 * release, so ~30 events/sec is the realistic ceiling with autorepeat already
 * suppressed. 5x that catches a regression that starts emitting per-repeat or
 * double-subscribes, without firing on a burst of real presses.
 */
const KEYBOARD_INPUT_BUDGET = new PerfBudget({
  name: "KeyboardTransport input events/sec",
  threshold: 150,
  windowMs: 1000,
  unit: "events",
});

/** Held while pressed makes the press a shortcut, not an action. Shift is
 *  deliberately absent: it changes which character a key produces, not which
 *  key it is, and `code` is unaffected by it. Excluding Shift would mean a
 *  bound key silently died whenever the operator happened to be holding it. */
const CHORD_MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "MetaLeft",
  "MetaRight",
  "AltLeft",
  "AltRight",
]);

/** The two keys the browser has already given to a focused control. */
const ACTIVATION_CODES = new Set(["Space", "Enter", "NumpadEnter"]);

const TEXT_ENTRY_ROLES = new Set([
  "textbox",
  "searchbox",
  "combobox",
  "spinbutton",
]);

const ACTIVATABLE_ROLES = new Set([
  "button",
  "link",
  "checkbox",
  "radio",
  "switch",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "tab",
]);

function elementFor(event: KeyboardEvent): Element | null {
  const target = event.target;
  if (target instanceof Element) return target;
  // A synthetic event dispatched at `window` has no element target; fall back
  // to whatever actually holds focus, which is what the rules are about.
  return typeof document === "undefined" ? null : document.activeElement;
}

function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  // `isContentEditable` is the direct answer and jsdom does not implement it
  // (it reads false for an editable div), so the attribute walk is what
  // actually decides in tests. Both are kept: the property also covers an
  // element made editable through `designMode` rather than the attribute.
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  if (el.closest('[contenteditable]:not([contenteditable="false"])')) {
    return true;
  }
  const tag = el.tagName;
  // Every <input> counts, not just the text-shaped ones: a checkbox or a
  // range input answers to Space and the arrow keys respectively, and both
  // are the operator typing at the page rather than at a widget.
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  const role = el.getAttribute("role");
  return role !== null && TEXT_ENTRY_ROLES.has(role);
}

function isActivatable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "BUTTON" || tag === "SUMMARY") return true;
  if (tag === "A" && el.hasAttribute("href")) return true;
  const role = el.getAttribute("role");
  return role !== null && ACTIVATABLE_ROLES.has(role);
}

export class KeyboardTransport implements DeviceTransport {
  readonly id: string;
  status: TransportStatus = "disconnected";

  private readonly inputListeners = new Set<(event: InputEvent) => void>();
  private readonly statusListeners = new Set<
    (status: TransportStatus, err?: unknown) => void
  >();
  /** Codes currently down, so a release only ever answers a press this
   *  transport actually emitted, and so a blur knows what to let go of. */
  private readonly held = new Set<string>();

  private keyDownListener: ((event: KeyboardEvent) => void) | null = null;
  private keyUpListener: ((event: KeyboardEvent) => void) | null = null;
  private blurListener: (() => void) | null = null;
  private visibilityListener: (() => void) | null = null;

  constructor(id: string) {
    this.id = id;
  }

  connect(): Promise<void> {
    if (this.status === "connected") return Promise.resolve();
    if (typeof window === "undefined") return Promise.resolve();

    this.keyDownListener = (event) => this.handleKeyDown(event);
    this.keyUpListener = (event) => this.handleKeyUp(event);
    this.blurListener = () => this.releaseAll();
    this.visibilityListener = () => {
      if (document.visibilityState === "hidden") this.releaseAll();
    };

    window.addEventListener("keydown", this.keyDownListener);
    window.addEventListener("keyup", this.keyUpListener);
    window.addEventListener("blur", this.blurListener);
    document.addEventListener("visibilitychange", this.visibilityListener);
    this.setStatus("connected");
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    if (typeof window !== "undefined") {
      if (this.keyDownListener) {
        window.removeEventListener("keydown", this.keyDownListener);
      }
      if (this.keyUpListener) {
        window.removeEventListener("keyup", this.keyUpListener);
      }
      if (this.blurListener) {
        window.removeEventListener("blur", this.blurListener);
      }
      if (this.visibilityListener) {
        document.removeEventListener(
          "visibilitychange",
          this.visibilityListener,
        );
      }
    }
    this.keyDownListener = null;
    this.keyUpListener = null;
    this.blurListener = null;
    this.visibilityListener = null;
    this.releaseAll();
    this.setStatus("disconnected");
    return Promise.resolve();
  }

  /** A keyboard has nothing to render to. */
  write(_data: string | Uint8Array): Promise<void> {
    return Promise.resolve();
  }

  onInput(cb: (event: InputEvent) => void): () => void {
    this.inputListeners.add(cb);
    return () => {
      this.inputListeners.delete(cb);
    };
  }

  onStatus(cb: (status: TransportStatus, err?: unknown) => void): () => void {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (!isKeyboardInputCode(event.code)) return;
    if (this.held.has(event.code)) return;
    if (this.isSuppressed(event)) return;
    this.held.add(event.code);
    this.emit(event.code, true);
  }

  private handleKeyUp(event: KeyboardEvent): void {
    // No suppression check here, and deliberately: the release answers a press
    // this transport already emitted. Re-testing the rules would strand a key
    // as held whenever focus moved into a text field mid-press.
    if (!this.held.delete(event.code)) return;
    this.emit(event.code, false);
  }

  private isSuppressed(event: KeyboardEvent): boolean {
    if (
      !CHORD_MODIFIER_CODES.has(event.code) &&
      (event.ctrlKey || event.metaKey || event.altKey)
    ) {
      return true;
    }
    const el = elementFor(event);
    if (isTextEntry(el)) return true;
    return ACTIVATION_CODES.has(event.code) && isActivatable(el);
  }

  private releaseAll(): void {
    if (this.held.size === 0) return;
    const codes = Array.from(this.held);
    this.held.clear();
    for (const code of codes) this.emit(code, false);
  }

  private emit(code: string, value: boolean): void {
    KEYBOARD_INPUT_BUDGET.record();
    const event: InputEvent = { inputId: code, value };
    this.inputListeners.forEach((cb) => {
      cb(event);
    });
  }

  private setStatus(status: TransportStatus, err?: unknown): void {
    this.status = status;
    this.statusListeners.forEach((cb) => {
      cb(status, err);
    });
  }
}
