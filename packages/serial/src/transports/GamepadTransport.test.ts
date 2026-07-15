import { afterEach, describe, expect, it } from "vitest";
import { MockGamepadAPI } from "../mocks/mockGamepad";
import type { DeviceType } from "../types";
import type { SchemaUpdate } from "./DeviceTransport";
import { GamepadPoller } from "./GamepadPoller";
import { GamepadTransport } from "./GamepadTransport";

const EMPTY_TYPE: DeviceType = {
  id: "gamepad-unconfigured",
  name: "Gamepad (unconfigured)",
  parser: "json-state",
  inputs: [],
  authoredBy: "device",
};

describe("GamepadTransport", () => {
  const mock = new MockGamepadAPI();
  // Every transport created in a test is tracked here so afterEach can
  // disconnect it — a transport left "waiting for a press" keeps a real
  // `window.addEventListener("gamepadconnected", ...)` registered, which
  // would otherwise survive into the next test and race its listener for
  // the next mock.connectPad() (claiming the pad first, or claiming an
  // index the next test expects to be free).
  let transports: GamepadTransport[] = [];
  function createTransport(
    opts: ConstructorParameters<typeof GamepadTransport>[0],
  ): GamepadTransport {
    const t = new GamepadTransport(opts);
    transports.push(t);
    return t;
  }

  afterEach(async () => {
    for (const t of transports) await t.disconnect();
    transports = [];
    mock.restore();
    GamepadPoller.resetForTests();
  });

  it("stays disconnected and waits for a press when no gamepadId is known yet (first pairing)", async () => {
    mock.install();
    const t = createTransport({ id: "d1", deviceType: EMPTY_TYPE });
    await t.connect();
    expect(t.status).toBe("disconnected");
  });

  it("connects on the first gamepadconnected press when unpaired", async () => {
    mock.install();
    const t = createTransport({ id: "d1", deviceType: EMPTY_TYPE });
    const statuses: string[] = [];
    t.onStatus((s) => statuses.push(s));

    await t.connect();
    mock.connectPad(0, { id: "Pad A", buttonCount: 18, axisCount: 4 });

    expect(t.status).toBe("connected");
    expect(statuses).toEqual(["connected"]);
  });

  it("reconnects automatically to a remembered gamepadId already visible at connect()", async () => {
    mock.install();
    mock.connectPad(1, { id: "Pad A", buttonCount: 17, axisCount: 4 });
    const t = createTransport({
      id: "d1",
      deviceType: EMPTY_TYPE,
      gamepadId: "Pad A",
    });
    await t.connect();
    expect(t.status).toBe("connected");
  });

  it("prefers a standard-mapped entry over a non-standard duplicate of the same pad id", async () => {
    mock.install();
    // Two simultaneous live entries sharing an id — rare, but some
    // platforms can expose the same physical pad this way.
    mock.connectPad(0, {
      id: "Pad A",
      mapping: "",
      buttonCount: 12,
      axisCount: 2,
    });
    mock.connectPad(1, {
      id: "Pad A",
      mapping: "standard",
      buttonCount: 17,
      axisCount: 4,
    });
    const t = createTransport({
      id: "d1",
      deviceType: EMPTY_TYPE,
      gamepadId: "Pad A",
    });
    const updates: SchemaUpdate[] = [];
    t.onSchema((u) => updates.push(u));

    await t.connect();

    expect(t.status).toBe("connected");
    expect(updates[0].typeId).toBe("gamepad-standard-17b-4a");
  });

  it("does not adopt a live pad with a different id when a specific gamepadId is remembered", async () => {
    mock.install();
    mock.connectPad(0, { id: "Pad B" });
    const t = createTransport({
      id: "d1",
      deviceType: EMPTY_TYPE,
      gamepadId: "Pad A",
    });
    await t.connect();
    expect(t.status).toBe("disconnected");
  });

  it("does not claim a pad index another transport has already claimed", async () => {
    mock.install();
    const t1 = createTransport({
      id: "d1",
      deviceType: EMPTY_TYPE,
      gamepadId: "Pad A",
    });
    const t2 = createTransport({
      id: "d2",
      deviceType: EMPTY_TYPE,
      gamepadId: "Pad A",
    });
    await t1.connect();
    await t2.connect();
    mock.connectPad(0, { id: "Pad A" });

    // t1 was listening first and wins; t2 stays waiting rather than double
    // claiming the same physical index.
    expect(t1.status).toBe("connected");
    expect(t2.status).toBe("disconnected");
  });

  it("emits a schema update with shape-derived inputs and typeId on connect", async () => {
    mock.install();
    const t = createTransport({ id: "d1", deviceType: EMPTY_TYPE });
    const updates: SchemaUpdate[] = [];
    t.onSchema((u) => updates.push(u));

    await t.connect();
    mock.connectPad(0, { id: "Pad A", buttonCount: 18, axisCount: 4 });

    expect(updates).toHaveLength(1);
    expect(updates[0].typeId).toBe("gamepad-standard-18b-4a");
    expect(updates[0].gamepadId).toBe("Pad A");
    expect(updates[0].inputs).toHaveLength(22);
  });

  it("disconnects cleanly and releases the poller claim", async () => {
    mock.install();
    const t = createTransport({ id: "d1", deviceType: EMPTY_TYPE });
    await t.connect();
    mock.connectPad(0, { id: "Pad A" });
    expect(t.status).toBe("connected");

    await t.disconnect();
    expect(t.status).toBe("disconnected");
    expect(GamepadPoller.get().isClaimed(0)).toBe(false);
  });

  it("flips to disconnected on a real gamepaddisconnected event for its own pad", async () => {
    mock.install();
    const t = createTransport({ id: "d1", deviceType: EMPTY_TYPE });
    await t.connect();
    mock.connectPad(0, { id: "Pad A" });
    expect(t.status).toBe("connected");

    mock.disconnectPad(0);
    expect(t.status).toBe("disconnected");
  });

  describe("frame diffing (via GamepadPoller.tick(), no real rAF)", () => {
    function makeStandardType(): DeviceType {
      return {
        id: "gamepad-standard-18b-4a",
        name: "Gamepad",
        parser: "json-state",
        authoredBy: "device",
        inputs: [
          { id: "button-0", name: "Face South", kind: "button" },
          {
            id: "button-6",
            name: "Trigger Left",
            kind: "analog",
            polarity: "unipolar",
          },
          {
            id: "axis-0",
            name: "Stick Left X",
            kind: "analog",
            polarity: "bipolar",
          },
        ],
      };
    }

    it("emits a boolean on a digital button press/release", async () => {
      mock.install();
      const t = createTransport({ id: "d1", deviceType: makeStandardType() });
      const events: Array<{ inputId: string; value: unknown }> = [];
      t.onInput((e) => events.push(e));
      await t.connect();
      mock.connectPad(0, { id: "Pad A", buttonCount: 18, axisCount: 4 });
      events.length = 0; // drop the connect-time baseline burst

      mock.setButton(0, 0, { pressed: true });
      mock.step();
      expect(events).toEqual([{ inputId: "button-0", value: true }]);

      mock.setButton(0, 0, { pressed: false });
      mock.step();
      expect(events.at(-1)).toEqual({ inputId: "button-0", value: false });
    });

    it("does not re-emit when a frame is unchanged", async () => {
      mock.install();
      const t = createTransport({ id: "d1", deviceType: makeStandardType() });
      const events: Array<{ inputId: string; value: unknown }> = [];
      t.onInput((e) => events.push(e));
      await t.connect();
      mock.connectPad(0, { id: "Pad A", buttonCount: 18, axisCount: 4 });
      events.length = 0;

      mock.step();
      mock.step();
      mock.step();

      expect(events).toEqual([]);
    });

    it("a released trigger (unipolar analog button) reads 0, not -1", async () => {
      mock.install();
      const t = createTransport({ id: "d1", deviceType: makeStandardType() });
      const events: Array<{ inputId: string; value: unknown }> = [];
      t.onInput((e) => events.push(e));
      await t.connect();
      mock.connectPad(0, { id: "Pad A", buttonCount: 18, axisCount: 4 });

      // A released trigger reports button.value === 0 from the browser —
      // pull it slightly, then all the way back to rest, and confirm rest
      // reads 0 (not -1, which is what the bipolar rescale would give a
      // released input without the unipolar branch).
      mock.setButton(0, 6, { value: 0.3 });
      mock.step();
      mock.setButton(0, 6, { value: 0 });
      mock.step();

      const trigger = events.filter((e) => e.inputId === "button-6").at(-1);
      expect(trigger?.value).toBe(0);
    });

    it("shapes a trigger pull through applyAnalogShaping (unipolar 0..1)", async () => {
      mock.install();
      const t = createTransport({ id: "d1", deviceType: makeStandardType() });
      const events: Array<{ inputId: string; value: unknown }> = [];
      t.onInput((e) => events.push(e));
      await t.connect();
      mock.connectPad(0, { id: "Pad A", buttonCount: 18, axisCount: 4 });
      events.length = 0;

      mock.setButton(0, 6, { value: 0.5 });
      mock.step();
      expect(events).toEqual([{ inputId: "button-6", value: 0.5 }]);
    });

    it("suppresses axis jitter below the change epsilon", async () => {
      mock.install();
      const t = createTransport({ id: "d1", deviceType: makeStandardType() });
      const events: Array<{ inputId: string; value: unknown }> = [];
      t.onInput((e) => events.push(e));
      await t.connect();
      mock.connectPad(0, { id: "Pad A", buttonCount: 18, axisCount: 4 });
      events.length = 0;

      mock.setAxis(0, 0, 0.0005); // below the 0.002 epsilon
      mock.step();
      expect(events.filter((e) => e.inputId === "axis-0")).toEqual([]);

      mock.setAxis(0, 0, 0.5); // well above it
      mock.step();
      expect(events.filter((e) => e.inputId === "axis-0")).toEqual([
        { inputId: "axis-0", value: 0.5 },
      ]);
    });

    it("one shared poller loop serves multiple connected transport instances", async () => {
      mock.install();
      const t1 = createTransport({ id: "d1", deviceType: makeStandardType() });
      const t2 = createTransport({ id: "d2", deviceType: makeStandardType() });
      const e1: Array<{ inputId: string; value: unknown }> = [];
      const e2: Array<{ inputId: string; value: unknown }> = [];
      t1.onInput((e) => e1.push(e));
      t2.onInput((e) => e2.push(e));

      await t1.connect();
      await t2.connect();
      mock.connectPad(0, { id: "Pad A", buttonCount: 18, axisCount: 4 });
      mock.connectPad(1, { id: "Pad B", buttonCount: 18, axisCount: 4 });
      e1.length = 0;
      e2.length = 0;

      mock.setButton(0, 0, { pressed: true });
      mock.setButton(1, 0, { pressed: true });
      mock.step();

      expect(e1).toEqual([{ inputId: "button-0", value: true }]);
      expect(e2).toEqual([{ inputId: "button-0", value: true }]);
    });
  });

  it("write() no-ops without throwing", async () => {
    const t = createTransport({ id: "d1", deviceType: EMPTY_TYPE });
    await expect(t.write("anything")).resolves.toBeUndefined();
  });

  it("updateDeviceType swaps the type used for kind/polarity lookups on the next frame", async () => {
    mock.install();
    const t = createTransport({ id: "d1", deviceType: EMPTY_TYPE });
    const events: Array<{ inputId: string; value: unknown }> = [];
    t.onInput((e) => events.push(e));
    await t.connect();
    mock.connectPad(0, { id: "Pad A", buttonCount: 1, axisCount: 0 });
    events.length = 0;

    // Re-type button-0 as an analog unipolar input.
    t.updateDeviceType({
      id: "x",
      name: "x",
      parser: "json-state",
      inputs: [
        {
          id: "button-0",
          name: "Trigger",
          kind: "analog",
          polarity: "unipolar",
        },
      ],
    });

    mock.setButton(0, 0, { value: 0.4, pressed: true });
    mock.step();
    expect(events).toEqual([{ inputId: "button-0", value: 0.4 }]);
  });
});
