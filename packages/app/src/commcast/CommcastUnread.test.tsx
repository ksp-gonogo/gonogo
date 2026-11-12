import { clearRegistry } from "@ksp-gonogo/core";
import { setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetSharedAudioContextForTests } from "../sound/audio";
import { type FakeOscillator, installFakeAudio } from "../test/fakeAudio";
import { CommcastWidget } from "./CommcastComponent";
import { CommcastLog } from "./CommcastLog";
import { CommcastLogProvider } from "./CommcastLogContext";
import type { CommsMessage } from "./types";

let oscillators: FakeOscillator[] = [];

beforeEach(() => {
  __resetSharedAudioContextForTests();
  oscillators = installFakeAudio();
});

afterEach(() => {
  clearRegistry();
  localStorage.clear();
});

function makeLog(): CommcastLog {
  const log = new CommcastLog({ screenKey: "screen-under-test" });
  log.setVantage("ksc");
  return log;
}

function incoming(over: Partial<CommsMessage> = {}): CommsMessage {
  return {
    id: "in1",
    to: ["ksc"],
    from: "vessel:ares",
    authorStationKey: "pilot-1",
    authorName: "Jeb",
    authorSeat: "pilot",
    sentUt: 0,
    lastSentUt: 0,
    attempts: 1,
    separationSeconds: 0,
    kind: "text",
    groupId: "g1",
    body: "Kennedy, Ares, we copy",
    ...over,
  };
}

function renderWidget(log: CommcastLog, config: Record<string, unknown> = {}) {
  const fixture = setupStreamFixture({ pinnedUt: 10 });
  const view = render(
    <fixture.Provider>
      <CommcastLogProvider log={log}>
        <CommcastWidget id="w1" config={config} w={6} h={8} />
      </CommcastLogProvider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("commandCentre.roster", [], { vantage: "ksc" });
    fixture.store.beginFrame();
  });
  return view;
}

describe("Commcast unread badge and chime", () => {
  it("shows an unread count in the header only while there are unread messages", async () => {
    const log = makeLog();
    renderWidget(log);
    expect(screen.queryByText(/\d+ new/)).not.toBeInTheDocument();
    await act(async () => {
      log.receiveTransmission(incoming());
      log.receiveTransmission(incoming({ id: "in2" }));
    });
    const [header] = await screen.findAllByText("2 new");
    expect(header).toBeInTheDocument();
    await act(async () => {
      log.markRead("g1");
    });
    expect(screen.queryByText(/\d+ new/)).not.toBeInTheDocument();
  });

  it("chimes once for a text message from someone else", async () => {
    const log = makeLog();
    renderWidget(log);
    expect(oscillators).toHaveLength(0);
    await act(async () => {
      log.receiveTransmission(incoming());
    });
    const afterOne = oscillators.length;
    expect(afterOne).toBeGreaterThan(0);
    await act(async () => {});
    expect(oscillators).toHaveLength(afterOne);
  });

  it("stays silent when the chime is switched off", async () => {
    const log = makeLog();
    renderWidget(log, { chime: false });
    await act(async () => {
      log.receiveTransmission(incoming());
    });
    expect(oscillators).toHaveLength(0);
  });

  it("stays silent for messages already in the log at mount", async () => {
    const log = makeLog();
    log.replaceForTesting({ inbox: [incoming({ receivedSeq: 1 })] });
    renderWidget(log);
    await act(async () => {});
    expect(oscillators).toHaveLength(0);
  });

  it("does not chime for a group membership change", async () => {
    const log = makeLog();
    renderWidget(log);
    await act(async () => {
      log.receiveTransmission(
        incoming({
          id: "mem",
          kind: "members",
          members: ["ksc", "vessel:ares"],
          added: ["ksc"],
        }),
      );
    });
    expect(oscillators).toHaveLength(0);
  });
});
