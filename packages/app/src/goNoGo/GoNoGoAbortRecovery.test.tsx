import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DashboardItemContext, ScreenProvider } from "@ksp-gonogo/core";
import { parseServerMessage, type StreamData } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it, vi } from "vitest";
import { type PeerClient, PeerClientProvider } from "../peer/PeerClientContext";
import { idlePeerClient } from "../test/peerFakes";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { GoNoGoComponent } from "./GoNoGoComponent";

/**
 * A flight recovered while the craft was out of contact, played from the wire as the rig recorded it: the Space Center scene arrives at once, while the craft's identity keeps its last report until the end of the flight is released a few seconds later.
 */

type Frame = StreamData<unknown>;

function recordedFrames(topics: readonly string[]): Frame[] {
  const file = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../tests/fixtures/wire/recovery-out-of-contact-landed.jsonl",
  );
  const frames: Frame[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const message = parseServerMessage(JSON.stringify(JSON.parse(line).f));
    if (message.type === "stream-data" && topics.includes(message.topic)) {
      frames.push(message);
    }
  }
  return frames.sort((a, b) => a.meta.deliveredAt - b.meta.deliveredAt);
}

function mountStation() {
  const fixture = setupStreamFixture({ pinnedUt: 637_583_500 });
  const sendGonogoAbort = vi.fn();
  const client: PeerClient = { ...idlePeerClient(), sendGonogoAbort };
  render(
    <ScreenProvider value="station">
      <PeerClientProvider client={client}>
        <fixture.Provider>
          <DashboardItemContext.Provider value={{ instanceId: "gng" }}>
            <GoNoGoComponent id="gng" w={6} h={8} />
          </DashboardItemContext.Provider>
        </fixture.Provider>
      </PeerClientProvider>
    </ScreenProvider>,
  );
  const frames = recordedFrames(["vessel.identity", "spaceCenter.scene"]);
  let next = 0;
  /** Delivers recorded frames until the next is one `stop` accepts, and leaves that one undelivered. */
  function playUntil(stop: (frame: Frame) => boolean) {
    act(() => {
      while (next < frames.length && !stop(frames[next])) {
        const frame = frames[next++];
        fixture.emit(frame.topic, frame.payload, frame.meta);
      }
    });
  }
  /** Delivers the frame `playUntil` stopped at, and every one after it, up to the next. */
  function playOne() {
    act(() => {
      const frame = frames[next++];
      fixture.emit(frame.topic, frame.payload, frame.meta);
    });
  }
  return { playUntil, playOne, sendGonogoAbort };
}

/** The abort control carries the alert role, so it is found by its label. */
async function abortControl() {
  const label = await screen.findByText("ABORT");
  const button = label.closest("button");
  if (button === null) throw new Error("ABORT is not on a button");
  return button;
}

function isScene(payload: unknown, scene: string): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "scene" in payload &&
    payload.scene === scene
  );
}

const arrivesAtSpaceCenter = (frame: Frame) =>
  frame.topic === "spaceCenter.scene" && isScene(frame.payload, "SpaceCenter");

describe("GO/NO-GO station abort after a recovery", () => {
  it("is live while the craft is flying", async () => {
    const { playUntil } = mountStation();
    playUntil(arrivesAtSpaceCenter);

    expect(await abortControl()).toBeEnabled();
  });

  it("is disabled, saying why, once the game is at the Space Center", async () => {
    const { playUntil, playOne, sendGonogoAbort } = mountStation();
    playUntil(arrivesAtSpaceCenter);
    playOne();

    const abort = await abortControl();
    expect(abort).toBeDisabled();
    expect(abort).toHaveTextContent("No flight in progress");
    abort.click();
    expect(sendGonogoAbort).not.toHaveBeenCalled();
  });
});
