import { render, renderHook } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import {
  TelemetryProvider,
  useCarriedChannels,
  useCarriedChannelsOptional,
} from "./context";
import { DYNAMIC_CARRIED_TOPIC_PREFIXES } from "./default-carried-topics";
import { StubTransport } from "./stub-transport";
import type { Transport, TransportStatus } from "./transport";

/**
 * The carried set `TelemetryProvider` builds always folds in the dynamic
 * whole-topic prefixes (see context.tsx) on top of the transport declaration +
 * the explicit prop, so expectations union them in.
 */
function carriedWith(...topics: string[]): ReadonlySet<string> {
  return new Set([...topics, ...DYNAMIC_CARRIED_TOPIC_PREFIXES]);
}

/** A `Transport` that declares a fixed set of carried channels (mirrors what `ReplayTransport` does with the real fixture's topic set). */
class DeclaringTransport implements Transport {
  readonly status: TransportStatus = "connected";
  constructor(readonly carriedChannels: readonly string[]) {}
  send(): void {}
  onMessage(): () => void {
    return () => {};
  }
  onStatusChange(): () => void {
    return () => {};
  }
}

describe("useCarriedChannelsOptional", () => {
  it("is undefined with no TelemetryProvider mounted", () => {
    const { result } = renderHook(() => useCarriedChannelsOptional());
    expect(result.current).toBeUndefined();
  });
});

describe("TelemetryProvider builds its carried-channels allowlist from the transport's declaration + the explicit promotion prop", () => {
  it("seeds from the transport's own declared carriedChannels when no prop is given", () => {
    const client = new TelemetryClient(
      new DeclaringTransport(["vessel.orbit", "vessel.flight"]),
    );
    let seen: ReadonlySet<string> | undefined;
    function Probe() {
      seen = useCarriedChannels();
      return null;
    }
    render(
      <TelemetryProvider client={client}>
        <Probe />
      </TelemetryProvider>,
    );
    expect(seen).toEqual(carriedWith("vessel.orbit", "vessel.flight"));
  });

  it("unions the explicit carriedChannels prop with the transport's declaration", () => {
    const client = new TelemetryClient(
      new DeclaringTransport(["vessel.orbit"]),
    );
    let seen: ReadonlySet<string> | undefined;
    function Probe() {
      seen = useCarriedChannels();
      return null;
    }
    render(
      <TelemetryProvider client={client} carriedChannels={["vessel.control"]}>
        <Probe />
      </TelemetryProvider>,
    );
    expect(seen).toEqual(carriedWith("vessel.orbit", "vessel.control"));
  });

  it("a transport that does not declare (StubTransport) carries only the explicit promotion list", () => {
    const client = new TelemetryClient(new StubTransport());
    let seen: ReadonlySet<string> | undefined;
    function Probe() {
      seen = useCarriedChannels();
      return null;
    }
    render(
      <TelemetryProvider client={client} carriedChannels={["vessel.orbit"]}>
        <Probe />
      </TelemetryProvider>,
    );
    expect(seen).toEqual(carriedWith("vessel.orbit"));
  });

  it("MONOTONIC: promoting a topic on a re-render adds it, and a later render that omits it does NOT drop it", () => {
    const client = new TelemetryClient(new StubTransport());
    const seenPerRender: ReadonlySet<string>[] = [];
    function Probe() {
      seenPerRender.push(useCarriedChannels());
      return null;
    }

    const { rerender } = render(
      <TelemetryProvider client={client} carriedChannels={["vessel.orbit"]}>
        <Probe />
      </TelemetryProvider>,
    );
    expect(seenPerRender.at(-1)).toEqual(carriedWith("vessel.orbit"));

    // Promote a second topic.
    rerender(
      <TelemetryProvider
        client={client}
        carriedChannels={["vessel.orbit", "vessel.flight"]}
      >
        <Probe />
      </TelemetryProvider>,
    );
    expect(seenPerRender.at(-1)).toEqual(
      carriedWith("vessel.orbit", "vessel.flight"),
    );

    // A later render's prop SHRINKS back to just the first topic — the
    // already-carried "vessel.flight" must still read as carried (never a
    // reversal mid-session).
    rerender(
      <TelemetryProvider client={client} carriedChannels={["vessel.orbit"]}>
        <Probe />
      </TelemetryProvider>,
    );
    expect(seenPerRender.at(-1)).toEqual(
      carriedWith("vessel.orbit", "vessel.flight"),
    );
  });
});
