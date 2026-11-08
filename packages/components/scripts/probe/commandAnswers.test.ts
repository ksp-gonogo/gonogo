import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CommandAnswers, installCommandAnswers } from "./commandAnswers";

const ANSWERS: CommandAnswers = {
  "vessel.control.setSas": [
    {
      args: { enabled: true },
      emits: [{ channel: "vessel.control", value: { sas: true } }],
    },
    {
      args: { enabled: false },
      emits: [{ channel: "vessel.control", value: { sas: false } }],
      afterMs: 500,
    },
  ],
};

function setup() {
  const transport = new StubTransport();
  const emitted: { topic: string; payload: unknown }[] = [];
  const cancel = installCommandAnswers(
    {
      transport,
      emit: (topic, payload) => emitted.push({ topic, payload }),
    },
    ANSWERS,
  );
  const send = (command: string, args: unknown) =>
    transport.send({
      type: "command-request",
      requestId: "r1",
      command,
      args,
      label: "test",
      topic: "t",
      sentAt: 0,
    });
  return { emitted, cancel, send };
}

describe("installCommandAnswers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits the matching case when its command is sent", async () => {
    const { emitted, send } = setup();
    send("vessel.control.setSas", { enabled: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(emitted).toEqual([
      { topic: "vessel.control", payload: { sas: true } },
    ]);
  });

  it("picks the case by args, and holds a delayed one until its time", async () => {
    const { emitted, send } = setup();
    send("vessel.control.setSas", { enabled: false });
    await vi.advanceTimersByTimeAsync(499);
    expect(emitted).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(emitted).toEqual([
      { topic: "vessel.control", payload: { sas: false } },
    ]);
  });

  it("answers nothing for a command with no case", async () => {
    const { emitted, send } = setup();
    send("vessel.control.setRcs", { enabled: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(emitted).toEqual([]);
  });

  it("drops a delayed answer when cancelled", async () => {
    const { emitted, send, cancel } = setup();
    send("vessel.control.setSas", { enabled: false });
    await vi.advanceTimersByTimeAsync(0);
    cancel();
    await vi.advanceTimersByTimeAsync(1000);
    expect(emitted).toEqual([]);
  });
});
