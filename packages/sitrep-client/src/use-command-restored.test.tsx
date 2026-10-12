import { FaultCode } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { localStorageOutstandingCommands } from "./outstanding-commands-storage";
import { makeMeta, StubTransport } from "./stub-transport";
import { useCommand } from "./use-command";

class ClaimingTransport extends StubTransport {
  readonly claimsAnswers = true;
}

function Deploy() {
  const cmd = useCommand("deploy");
  return (
    <div>
      <span>phase:{cmd.status.phase}</span>
      <span>refusals:{cmd.refusals.length}</span>
      <span>
        id:
        {cmd.status.phase === "idle" ? "none" : cmd.status.requestId}
      </span>
    </div>
  );
}

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

/** One page of a screen: a client over the screen's own store, left outstanding and disposed as a reload does. */
function leaveOutstanding(storage: ReturnType<typeof memoryStorage>) {
  const first = new TelemetryClient(new ClaimingTransport(), undefined, {
    idPrefix: "old",
    outstanding: localStorageOutstandingCommands("main", storage),
  });
  first.setDelaySource(() => 600);
  const { requestId, result } = first.dispatch("deploy", { n: 1 }, "Deploy");
  result.catch(() => undefined);
  first.dispose();
  return requestId;
}

describe("useCommand after a reload", () => {
  it("shows a command the last page left outstanding and settles it when the mod answers the claim", async () => {
    const storage = memoryStorage();
    const requestId = leaveOutstanding(storage);

    const transport = new ClaimingTransport();
    const client = new TelemetryClient(transport, undefined, {
      idPrefix: "new",
      outstanding: localStorageOutstandingCommands("main", storage),
    });
    render(
      <TelemetryProvider client={client}>
        <Deploy />
      </TelemetryProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText("phase:in-flight")).toBeTruthy(),
    );
    expect(screen.getByText(`id:${requestId}`)).toBeTruthy();

    act(() => {
      transport.emitRaw({
        type: "command-response",
        requestId,
        result: { ok: true },
        meta: makeMeta(),
      });
    });
    await waitFor(() =>
      expect(screen.getByText("phase:confirmed")).toBeTruthy(),
    );
    expect(
      storage.getItem("gonogo.sitrep.outstandingCommands.v1.main"),
    ).toBeNull();
  });

  it("records a refusal the mod answers the claim with", async () => {
    const storage = memoryStorage();
    const requestId = leaveOutstanding(storage);

    const transport = new ClaimingTransport();
    const client = new TelemetryClient(transport, undefined, {
      idPrefix: "new",
      outstanding: localStorageOutstandingCommands("main", storage),
    });
    render(
      <TelemetryProvider client={client}>
        <Deploy />
      </TelemetryProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText("phase:in-flight")).toBeTruthy(),
    );

    act(() => {
      transport.emitRaw({
        type: "command-response",
        requestId,
        result: { success: false, errorCode: "modeUnavailable" },
        meta: makeMeta(),
      });
    });
    await waitFor(() => expect(screen.getByText("refusals:1")).toBeTruthy());
  });

  it("calls a command lost when the mod holds nothing for its claim", async () => {
    const storage = memoryStorage();
    const requestId = leaveOutstanding(storage);

    const transport = new ClaimingTransport();
    const client = new TelemetryClient(transport, undefined, {
      idPrefix: "new",
      outstanding: localStorageOutstandingCommands("main", storage),
    });
    render(
      <TelemetryProvider client={client}>
        <Deploy />
      </TelemetryProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText("phase:in-flight")).toBeTruthy(),
    );

    act(() => {
      transport.emitRaw({
        type: "error",
        requestId,
        code: FaultCode.ReplyNotReceived,
        message: "the game holds no answer for that request",
      });
    });
    await waitFor(() => expect(screen.getByText("phase:lost")).toBeTruthy());
  });
});
