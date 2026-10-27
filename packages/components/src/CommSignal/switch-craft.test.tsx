import { useTelemetry } from "@ksp-gonogo/core";
import { DelayAuthority } from "@ksp-gonogo/sitrep-client";
import {
  CommsControlStateKind,
  CommsDelaySource,
  type Reading,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { act, render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import {
  type RigFixture,
  startRigReplay,
  wireFixture,
} from "../test/replayRig";

const PROBE = "7af03fa9-43f6-4263-b2c8-8a498dd42a84";
const CONTROL = "2c75c3b3-03c2-4e2d-a0b5-856ff50f6864";

/** What the signal and identity widgets read, captured on every render. */
const linkStates: string[] = [];
const shown: { level?: number; vesselId?: string }[] = [];

/** The value a reading carries, whether it is current or held. */
function carried<T>(reading: Reading<T>): T | undefined {
  return "value" in reading ? reading.value : undefined;
}

function Readings() {
  const control = useTelemetry("comms.control");
  const identity = useTelemetry("vessel.identity");
  const link = useTelemetry("comms.link");
  shown.push({
    level: carried(control.level),
    vesselId: carried(identity.vesselId),
  });
  linkStates.push(link.state);
  return null;
}

/**
 * The recording with the `comms.control` frame the mod now sends beside every
 * `comms.link` that reports nothing, which it predates: the same stamps as that
 * link frame and a level of Unknown.
 */
function withControlUnknownBesideUnreportedLinks(
  fixture: RigFixture,
): RigFixture {
  const frames = fixture.frames.flatMap((raw) => {
    const frame: {
      topic?: string;
      payload?: { connected?: boolean | null };
      meta?: { seq?: number };
    } = JSON.parse(raw);
    if (frame.topic !== "comms.link" || frame.payload?.connected !== null) {
      return [raw];
    }
    return [
      raw,
      JSON.stringify({
        ...frame,
        topic: "comms.control",
        payload: { level: CommsControlStateKind.Unknown, reason: null },
        meta: { ...frame.meta, seq: (frame.meta?.seq ?? 0) + 1 },
      }),
    ];
  });
  return { ...fixture, frames };
}

describe("switching from a craft 286 s away to a craft with no link", () => {
  it("reads the new craft's connection at once, not the old craft's for one delay", () => {
    shown.length = 0;
    const authority = new DelayAuthority();
    authority.observe({
      oneWaySeconds: value("s", 285.974),
      source: CommsDelaySource.SignalDelay,
      meta: { source: `vessel:${PROBE}` },
    });
    const replay = startRigReplay(
      withControlUnknownBesideUnreportedLinks(
        wireFixture("switch-probe-to-unlinked-craft"),
      ),
      { delayAuthority: authority },
    );
    render(
      <replay.Provider>
        <Readings />
      </replay.Provider>,
    );

    act(() => replay.advanceTo(1.5));
    expect(shown.at(-1)).toEqual({ level: 2, vesselId: PROBE });

    act(() => replay.advanceTo(30));
    expect(shown.at(-1)).toEqual({
      level: CommsControlStateKind.Unknown,
      vesselId: CONTROL,
    });

    act(() => replay.advanceTo(replay.duration));
    expect(shown.at(-1)?.vesselId).toBe(CONTROL);
  });

  it("reads a craft with no link as not connected once it is connected to, not as awaited for the old craft's delay", () => {
    linkStates.length = 0;
    const authority = new DelayAuthority();
    authority.observe({
      oneWaySeconds: value("s", 285.974),
      source: CommsDelaySource.SignalDelay,
      meta: { source: `vessel:${PROBE}` },
    });
    const replay = startRigReplay(
      wireFixture("first-frames-on-unlinked-craft"),
      { delayAuthority: authority },
    );
    render(
      <replay.Provider>
        <Readings />
      </replay.Provider>,
    );

    act(() => replay.advanceTo(replay.duration));
    expect(linkStates.at(-1)).toBe("observed");
  });
});
