import { ScreenProvider } from "@ksp-gonogo/core";
import { Situation, useLiftoffCountdown } from "@ksp-gonogo/sitrep-sdk";
import { stageCountdownStore } from "@ksp-gonogo/sitrep-sdk/spine";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { asHostService } from "../test/peerFakes";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { GoNoGoHostProvider } from "./GoNoGoHostContext";
import {
  type CountdownEvent,
  DEFAULT_GONOGO_CONFIG,
  GoNoGoHostService,
  type GoNoGoSnapshot,
} from "./GoNoGoHostService";
import { StageCountdownBridge } from "./StageCountdownBridge";

const quietHost = {
  onPeerConnect: () => () => {},
  onPeerDisconnect: () => () => {},
  onStationInfo: () => () => {},
  onGonogoVote: () => () => {},
  onGonogoAbort: () => () => {},
  broadcast: () => {},
  sendToPeer: () => {},
};

/** A poll whose snapshot and countdown events the test sets directly. */
class FakePoll extends GoNoGoHostService {
  private fakeLaunched = false;
  fakeOnGo: string = DEFAULT_GONOGO_CONFIG.onGo;
  private snapshotWatchers = new Set<() => void>();
  private countdownWatchers = new Set<(event: CountdownEvent) => void>();

  constructor() {
    super(asHostService(quietHost));
  }

  override getSnapshot(): GoNoGoSnapshot {
    return {
      ...super.getSnapshot(),
      launched: this.fakeLaunched,
      config: { ...DEFAULT_GONOGO_CONFIG, onGo: this.fakeOnGo },
    };
  }
  override subscribe(listener: () => void) {
    this.snapshotWatchers.add(listener);
    return () => {
      this.snapshotWatchers.delete(listener);
    };
  }
  override onCountdown(listener: (event: CountdownEvent) => void) {
    this.countdownWatchers.add(listener);
    return () => {
      this.countdownWatchers.delete(listener);
    };
  }
  setLaunched(launched: boolean) {
    this.fakeLaunched = launched;
    for (const l of this.snapshotWatchers) l();
  }
  fire(event: CountdownEvent) {
    for (const l of this.countdownWatchers) l(event);
  }
}

function LiftoffProbe() {
  const liftoff = useLiftoffCountdown();
  return (
    <output>
      {JSON.stringify(liftoff && { liftedOff: liftoff.liftedOff })}
    </output>
  );
}

function mount(phase: Situation, poll = new FakePoll()) {
  const fixture = setupStreamFixture({ suspendFrames: true });
  render(
    <ScreenProvider value="main">
      <GoNoGoHostProvider service={poll}>
        <fixture.Provider>
          <StageCountdownBridge />
          <LiftoffProbe />
        </fixture.Provider>
      </GoNoGoHostProvider>
    </ScreenProvider>,
  );
  act(() => fixture.emit("flight.current", { phase }));
  return poll;
}

const reading = () => screen.getByRole("status").textContent;
const START: CountdownEvent = { type: "start", lengthMs: 10_000 };

afterEach(() => stageCountdownStore.clear());

describe("the countdown the main screen's poll hands to the liftoff hook", () => {
  it("is a liftoff when the poll fires Stage and the craft is on the pad", () => {
    const poll = mount(Situation.PreLaunch);
    act(() => poll.fire(START));
    expect(reading()).toBe('{"liftedOff":false}');
  });

  it("is not a liftoff when the poll fires another action group", () => {
    const poll = new FakePoll();
    poll.fakeOnGo = "Custom01";
    mount(Situation.PreLaunch, poll);
    act(() => poll.fire(START));
    expect(reading()).toBe("null");
  });

  it("is not a liftoff for a craft that is already flying", () => {
    const poll = mount(Situation.Flying);
    act(() => poll.fire(START));
    expect(reading()).toBe("null");
  });

  it("is not a liftoff after an abort", () => {
    const poll = mount(Situation.PreLaunch);
    act(() => poll.fire(START));
    act(() => poll.fire({ type: "end", how: "aborted" }));
    expect(reading()).toBe("null");
  });

  it("has lifted off once the mission clock starts, and is forgotten when the craft is back on the pad", () => {
    const poll = mount(Situation.PreLaunch);
    act(() => poll.fire(START));
    act(() => poll.fire({ type: "end", how: "go" }));
    act(() => poll.setLaunched(true));
    expect(reading()).toBe('{"liftedOff":true}');
    act(() => poll.setLaunched(false));
    expect(reading()).toBe("null");
  });
});
