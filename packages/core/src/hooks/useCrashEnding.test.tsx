import { TelemetryClient, TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { useCrashEnding } from "./useCrashEnding";

/*
 * With no active vessel the vessel Topics read no value, so the hook keeps the
 * craft it last saw: a crash is the ending only when it is that craft's.
 */
function mount() {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const hook = renderHook(() => useCrashEnding(), {
    wrapper: ({ children }) => (
      <TelemetryProvider client={client}>{children}</TelemetryProvider>
    ),
  });
  return { transport, hook };
}

async function subscribed(transport: StubTransport) {
  await waitFor(() => {
    expect(transport.isSubscribed("crash.lastCrash")).toBe(true);
    expect(transport.isSubscribed("vessel.identity")).toBe(true);
  });
}

/** Holds the act scope open across the frames the view clock takes to deliver the last emit. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 3; i++)
      await new Promise((r) => requestAnimationFrame(r));
  });

const crashOf = (transport: StubTransport, vesselId: string) =>
  act(() => {
    transport.emit("crash.hasRecent", { recent: true });
    transport.emit("crash.lastCrash", { vesselId, ut: 1000 });
  });

const identity = (transport: StubTransport, vesselId: string | null) =>
  act(() =>
    transport.emit(
      "vessel.identity",
      (vesselId === null ? null : { vesselId }) as never,
    ),
  );

describe("useCrashEnding with no active vessel", () => {
  it("keeps the last craft's crash as the ending once the game has left flight", async () => {
    const { transport, hook } = mount();
    await subscribed(transport);
    identity(transport, "doomed");
    crashOf(transport, "doomed");
    await waitFor(() => expect(hook.result.current?.vesselId).toBe("doomed"));
    identity(transport, null);
    await waitFor(() => expect(hook.result.current?.vesselId).toBe("doomed"));
    await settle();
  });

  it("lets go once another craft has been seen", async () => {
    const { transport, hook } = mount();
    await subscribed(transport);
    identity(transport, "doomed");
    crashOf(transport, "doomed");
    await waitFor(() => expect(hook.result.current?.vesselId).toBe("doomed"));
    identity(transport, "next-craft");
    await waitFor(() => expect(hook.result.current).toBeUndefined());
    identity(transport, null);
    await waitFor(() => expect(hook.result.current).toBeUndefined());
    await settle();
  });

  it("has no ending for a crash on record when no craft has been seen", async () => {
    const { transport, hook } = mount();
    await subscribed(transport);
    identity(transport, null);
    crashOf(transport, "long-ago");
    await settle();
    expect(hook.result.current).toBeUndefined();
  });
});
