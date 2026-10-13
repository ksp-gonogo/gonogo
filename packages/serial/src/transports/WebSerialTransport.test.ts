import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockWebSerial } from "../mocks/mockWebSerial";
import type { DeviceType } from "../types";
import type { InputEvent } from "./DeviceTransport";
import { WebSerialTransport } from "./WebSerialTransport";

const TYPE: DeviceType = {
  id: "panel",
  name: "Panel",
  parser: "char-position",
  inputs: [
    { id: "sw", name: "Switch", kind: "button", offset: 0, length: 1 },
    { id: "btn", name: "Button", kind: "button", offset: 1, length: 1 },
  ],
};

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("WebSerialTransport input events", () => {
  let mock: MockWebSerial;

  beforeEach(() => {
    mock = new MockWebSerial();
    mock.install({ force: true });
  });

  afterEach(() => {
    mock.restore();
  });

  async function connected() {
    const port = mock.createPort();
    const transport = new WebSerialTransport({ id: "t", deviceType: TYPE });
    const events: InputEvent[] = [];
    transport.onInput((e) => events.push(e));
    await transport.connect();
    return { port, transport, events };
  }

  it("emits a held button once, however many lines repeat it", async () => {
    const { port, transport, events } = await connected();
    await port.emitData("00\n01\n01\n01\n01\n00\n00\n");
    await settle();
    expect(events).toEqual([
      { inputId: "btn", value: true },
      { inputId: "btn", value: false },
    ]);
    await transport.disconnect();
  });

  it("emits nothing for a switch that is already on when the device connects", async () => {
    const { port, transport, events } = await connected();
    await port.emitData("10\n10\n10\n");
    await settle();
    expect(events).toEqual([]);
    await transport.disconnect();
  });

  it("starts each session from the device's state, without a half line from the last one", async () => {
    const { port, transport, events } = await connected();
    await port.emitData("00\n01\n0");
    await settle();
    await transport.disconnect();
    events.length = 0;

    const next = mock.createPort();
    await transport.connect();
    await next.emitData("01\n01\n");
    await settle();
    expect(events).toEqual([]);
    await transport.disconnect();
  });
});
