import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useTagValues } from "./NotesComponent";

/**
 * A note body's `{{tag}}` placeholders read straight off the stream: there is
 * no `DataSource` behind the `"data"` id this resolves through, and has not
 * been since that source was deleted.
 *
 * That is the CANONICAL read shape, so the carried-channels gate had nothing to
 * arbitrate here and could only suppress. A tag whose topic was absent from the
 * allowlist never subscribed, so it rendered nothing for ever, silently, and
 * the unowned-topic warning could not name it because that warning only hears
 * about topics something subscribed to.
 */
function withProvider(client: TelemetryClient) {
  return ({ children }: { children: ReactNode }) => (
    <TelemetryProvider client={client}>{children}</TelemetryProvider>
  );
}

describe("note tag values", () => {
  it("resolves a tag whose topic the allowlist omits, because there is no fallback for the gate to prefer", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    // "vessel.control" deliberately absent from carriedChannels: the list is
    // seeded from declarations and a promotion list, not from what arrives.
    const { result } = renderHook(
      () => useTagValues(["vessel.control.throttle"]),
      { wrapper: withProvider(client) },
    );

    act(() => transport.emit("vessel.control", { throttle: 0.75 }));

    // RED before the gate was dropped: the tag never subscribed, so this stayed
    // empty for the life of the note.
    await waitFor(() =>
      expect(result.current.get("vessel.control.throttle")).toBeDefined(),
    );
  });

  it("leaves a tag naming no topic at all unresolved, which is the only thing that should render as nothing", () => {
    const client = new TelemetryClient(new StubTransport());

    const { result } = renderHook(() => useTagValues(["not.a.real.field"]), {
      wrapper: withProvider(client),
    });

    expect(result.current.get("not.a.real.field")).toBeUndefined();
  });
});
