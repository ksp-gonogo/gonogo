import { value, valueCommandState } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { StubTransport } from "./stub-transport";

const COMMAND = "vessel.setPartField";
const ARGS = {
  partId: "1234567",
  module: "ModuleEnginesFX",
  field: "thrustPercentage",
  value: 73.5,
};

function connect(
  handler: Parameters<StubTransport["setCommandHandler"]>[0] = () => ({
    success: true,
  }),
) {
  const transport = new StubTransport();
  transport.setCommandHandler(handler);
  const client = new TelemetryClient(transport, undefined, { idPrefix: "t" });
  return { transport, client };
}

describe("vessel.setPartField through the real client", () => {
  it("sends the part, module, field and value exactly as given and confirms on success", async () => {
    const { transport, client } = connect();

    const { requestId, result } = client.dispatch(
      COMMAND,
      ARGS,
      "Thrust limiter",
      "vessel.partActions.1234567",
    );
    await result;

    expect(transport.sentCommands).toHaveLength(1);
    expect(transport.sentCommands[0].command).toBe(COMMAND);
    expect(transport.sentCommands[0].args).toEqual(ARGS);
    expect(client.getCommand(requestId).phase).toBe("confirmed");
  });

  it.each([
    "notFound",
    "range",
    "capabilityMismatch",
  ])("reads a %s refusal as refused", async (errorCode) => {
    const { client } = connect(() => ({ success: false, errorCode }));

    const { requestId, result } = client.dispatch(COMMAND, ARGS);
    await expect(result).rejects.toBeDefined();

    expect(client.getCommand(requestId).phase).toBe("refused");
  });
});

describe("the value vessel.setPartField commands", () => {
  const queue = {
    pending: [
      {
        id: "e-1",
        clientRequestId: "c-1",
        command: COMMAND,
        label: "",
        topic: "vessel.partActions.1234567",
        vantage: "ground:Kerbin: KSC",
        dispatchedAt: value("ut", 0),
        oneWaySeconds: value("s", 4),
        commandedValue: 73.5,
      },
      {
        id: "e-2",
        clientRequestId: "c-2",
        command: COMMAND,
        label: "",
        topic: "vessel.partActions.7654321",
        vantage: "ground:Kerbin: KSC",
        dispatchedAt: value("ut", 1),
        oneWaySeconds: value("s", 4),
        commandedValue: 20,
      },
    ],
  };

  it("is the value the operator sent to this part, beside the one the craft last reported", () => {
    const state = valueCommandState(
      COMMAND,
      {
        received: 100,
        matches: (entry) => entry.topic === "vessel.partActions.1234567",
      },
      queue,
      value("s", 4),
      value("ut", 2),
    );

    expect(state.commanded).toBe(73.5);
    expect(state.inFlight).toHaveLength(1);
  });
});
