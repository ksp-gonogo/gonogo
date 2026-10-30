import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ScreenProvider } from "@ksp-gonogo/core";
import { SerialDeviceProvider, SerialDeviceService } from "@ksp-gonogo/serial";
import { parseServerMessage, type StreamData } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import { describe, expect, it, vi } from "vitest";
import { type PeerClient, PeerClientProvider } from "../peer/PeerClientContext";
import {
  StationIdentityProvider,
  StationIdentityService,
} from "../stationIdentity";
import { idlePeerClient } from "../test/peerFakes";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { StationPollControl } from "./StationPollControl";

/**
 * A flight recovered while the craft was out of contact, played from the wire as the rig recorded it: the Space Center scene and the end of the flight arrive together, and the craft's identity is never withdrawn, so the control has to follow the scene.
 */

type Frame = StreamData<unknown>;

/** The recorded craft was dropped onto the ground and never launched, so its identity carries no launch time; the abort control only shows for a craft past liftoff. */
const LAUNCHED_AT_UT = 637_583_900;

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
      frames.push(
        message.topic === "vessel.identity" && message.payload !== null
          ? {
              ...message,
              payload: {
                ...(message.payload as object),
                launchUt: LAUNCHED_AT_UT,
              },
            }
          : message,
      );
    }
  }
  return frames.sort((a, b) => a.meta.deliveredAt - b.meta.deliveredAt);
}

function mountStation() {
  const fixture = setupStreamFixture({ pinnedUt: 637_583_965 });
  const sendGonogoAbort = vi.fn();
  const client: PeerClient = { ...idlePeerClient(), sendGonogoAbort };
  render(
    <ScreenProvider value="station">
      <ModalProvider>
        <SerialDeviceProvider
          service={new SerialDeviceService({ screenKey: "station" })}
        >
          <StationIdentityProvider service={new StationIdentityService()}>
            <PeerClientProvider client={client}>
              <fixture.Provider>
                <StationPollControl />
              </fixture.Provider>
            </PeerClientProvider>
          </StationIdentityProvider>
        </SerialDeviceProvider>
      </ModalProvider>
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

  it("is gone once the game is at the Space Center", async () => {
    const { playUntil, playOne, sendGonogoAbort } = mountStation();
    playUntil(arrivesAtSpaceCenter);
    await abortControl();
    playOne();

    await waitFor(() => expect(screen.queryByText("ABORT")).toBeNull());
    expect(sendGonogoAbort).not.toHaveBeenCalled();
  });
});
