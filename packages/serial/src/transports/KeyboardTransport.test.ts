import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InputEvent } from "./DeviceTransport";
import { KeyboardTransport } from "./KeyboardTransport";

function press(
  target: EventTarget,
  code: string,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    code,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function release(
  target: EventTarget,
  code: string,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keyup", {
    code,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe("KeyboardTransport", () => {
  let transport: KeyboardTransport;
  let events: InputEvent[];

  beforeEach(async () => {
    transport = new KeyboardTransport("kbd");
    events = [];
    transport.onInput((e) => events.push(e));
    await transport.connect();
  });

  afterEach(async () => {
    await transport.disconnect();
    document.body.innerHTML = "";
  });

  it("connects and disconnects without anything to pair", async () => {
    const statuses: string[] = [];
    const t = new KeyboardTransport("kbd-2");
    t.onStatus((s) => statuses.push(s));

    expect(t.status).toBe("disconnected");
    await t.connect();
    expect(t.status).toBe("connected");
    await t.disconnect();
    expect(t.status).toBe("disconnected");
    expect(statuses).toEqual(["connected", "disconnected"]);
  });

  it("emits the physical key code on press and release", () => {
    press(window, "KeyW");
    release(window, "KeyW");

    expect(events).toEqual([
      { inputId: "KeyW", value: true },
      { inputId: "KeyW", value: false },
    ]);
  });

  it("never preventDefaults, so the page keeps its own keyboard", () => {
    const down = press(window, "KeyW");
    const tab = press(window, "Tab");
    const enter = press(window, "Enter");
    const space = press(window, "Space");

    expect(down.defaultPrevented).toBe(false);
    expect(tab.defaultPrevented).toBe(false);
    expect(enter.defaultPrevented).toBe(false);
    expect(space.defaultPrevented).toBe(false);
  });

  it("carries no input for Tab or Escape, which the page needs back", () => {
    press(window, "Tab");
    release(window, "Tab");
    press(window, "Escape");
    release(window, "Escape");

    expect(events).toEqual([]);
  });

  it("emits nothing for a key outside the table", () => {
    press(window, "MediaPlayPause");
    expect(events).toEqual([]);
  });

  it("drops OS key repeat, so a held key dispatches its action once", () => {
    press(window, "KeyW");
    press(window, "KeyW", { repeat: true });
    press(window, "KeyW", { repeat: true });
    release(window, "KeyW");

    expect(events).toEqual([
      { inputId: "KeyW", value: true },
      { inputId: "KeyW", value: false },
    ]);
  });

  describe("text entry", () => {
    it("emits nothing for a key typed into an input", () => {
      const input = document.createElement("input");
      document.body.append(input);
      input.focus();

      press(input, "KeyW");
      release(input, "KeyW");

      expect(events).toEqual([]);
    });

    it("emits nothing for a key typed into a textarea", () => {
      const area = document.createElement("textarea");
      document.body.append(area);
      area.focus();

      press(area, "KeyW");

      expect(events).toEqual([]);
    });

    it("emits nothing for a key typed into a contenteditable", () => {
      /**
       * The attribute, not the `contentEditable` property: jsdom implements
       * neither that property nor `isContentEditable`, so setting it would
       * leave the element indistinguishable from a plain div and this test
       * would be asserting nothing.
       */
      const editable = document.createElement("div");
      editable.setAttribute("contenteditable", "true");
      const inner = document.createElement("span");
      editable.append(inner);
      document.body.append(editable);

      press(inner, "KeyW");

      expect(events).toEqual([]);
    });

    it("still emits for the same key pressed outside any text field", () => {
      // The counterweight to the three above: without it they would pass just
      // as happily if the transport emitted nothing at all.
      const div = document.createElement("div");
      document.body.append(div);

      press(div, "KeyW");

      expect(events).toEqual([{ inputId: "KeyW", value: true }]);
    });
  });

  describe("a focused control keeps Enter and Space", () => {
    it("emits nothing for Space or Enter while a button has focus", () => {
      const button = document.createElement("button");
      document.body.append(button);
      button.focus();

      press(button, "Space");
      press(button, "Enter");

      expect(events).toEqual([]);
    });

    it("emits every other key while a button has focus", () => {
      const button = document.createElement("button");
      document.body.append(button);
      button.focus();

      press(button, "KeyW");

      expect(events).toEqual([{ inputId: "KeyW", value: true }]);
    });

    it("emits Space when nothing activatable has focus", () => {
      press(window, "Space");
      expect(events).toEqual([{ inputId: "Space", value: true }]);
    });
  });

  describe("modifiers", () => {
    it("emits nothing for a key held under Ctrl, Meta or Alt", () => {
      press(window, "KeyW", { ctrlKey: true });
      press(window, "KeyS", { metaKey: true });
      press(window, "KeyD", { altKey: true });

      expect(events).toEqual([]);
    });

    it("emits a bare modifier, which is a key press and not a chord", () => {
      // The browser reports the modifier's own flag on its own keydown, so
      // this is exactly the case the rule above must not swallow.
      press(window, "ControlLeft", { ctrlKey: true });
      release(window, "ControlLeft", { ctrlKey: false });

      expect(events).toEqual([
        { inputId: "ControlLeft", value: true },
        { inputId: "ControlLeft", value: false },
      ]);
    });

    it("still emits under Shift, which changes the character and not the key", () => {
      press(window, "KeyW", { shiftKey: true });
      expect(events).toEqual([{ inputId: "KeyW", value: true }]);
    });

    it("emits no release for a key whose press was suppressed", () => {
      press(window, "KeyW", { ctrlKey: true });
      // Ctrl let go first, so the release arrives unmodified. Answering it
      // would hand the action a `false` for a `true` it never got.
      release(window, "KeyW");

      expect(events).toEqual([]);
    });
  });

  describe("a key held across a blur", () => {
    it("releases on window blur, because the keyup lands elsewhere", () => {
      press(window, "KeyW");
      window.dispatchEvent(new Event("blur"));

      expect(events).toEqual([
        { inputId: "KeyW", value: true },
        { inputId: "KeyW", value: false },
      ]);
    });

    it("releases when the tab goes hidden", () => {
      press(window, "KeyW");
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));

      expect(events).toEqual([
        { inputId: "KeyW", value: true },
        { inputId: "KeyW", value: false },
      ]);
      vi.restoreAllMocks();
    });

    it("does not release twice when the real keyup arrives after the blur", () => {
      press(window, "KeyW");
      window.dispatchEvent(new Event("blur"));
      release(window, "KeyW");

      expect(events).toEqual([
        { inputId: "KeyW", value: true },
        { inputId: "KeyW", value: false },
      ]);
    });

    it("releases a held key on disconnect", async () => {
      press(window, "KeyW");
      await transport.disconnect();

      expect(events).toEqual([
        { inputId: "KeyW", value: true },
        { inputId: "KeyW", value: false },
      ]);
    });
  });

  it("stops listening once disconnected", async () => {
    await transport.disconnect();
    press(window, "KeyW");
    expect(events).toEqual([]);
  });
});
