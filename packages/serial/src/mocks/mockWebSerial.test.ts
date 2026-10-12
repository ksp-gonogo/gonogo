import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSerialTransport } from "../transports/WebSerialTransport";
import type { DeviceType } from "../types";
import { MockWebSerial } from "./mockWebSerial";

const TYPE: DeviceType = {
  id: "demo",
  name: "Demo",
  parser: "char-position",
  inputs: [
    { id: "a", name: "A", kind: "button", offset: 1, length: 1 },
    { id: "b", name: "B", kind: "button", offset: 3, length: 1 },
  ],
};

describe("MockWebSerial", () => {
  let mock: MockWebSerial;

  beforeEach(() => {
    mock = new MockWebSerial();
    mock.install({ force: true });
  });

  afterEach(() => {
    mock.restore();
  });

  it("hands WebSerialTransport a port-shaped object that routes real streams", async () => {
    const port = mock.createPort();
    const transport = new WebSerialTransport({ id: "t", deviceType: TYPE });
    const events: Array<{ inputId: string; value: boolean | number }> = [];
    transport.onInput((e) => events.push(e));

    await transport.connect();
    expect(transport.status).toBe("connected");

    await port.emitData(" 1 0 \n");
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(events).toEqual([
      { inputId: "a", value: true },
      { inputId: "b", value: false },
    ]);

    await transport.disconnect();
  });

  it("captures frames written by the transport via drainWrittenText()", async () => {
    const port = mock.createPort();
    const transport = new WebSerialTransport({ id: "t", deviceType: TYPE });
    await transport.connect();

    await transport.write("hello");
    // Give the drain loop a tick.
    for (let i = 0; i < 3; i++) await Promise.resolve();

    expect(port.drainWrittenText()).toBe("hello");
    await transport.disconnect();
  });
});
