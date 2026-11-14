import { dispatchAction, ScreenProvider } from "@ksp-gonogo/core";
import { SerialDeviceProvider, SerialDeviceService } from "@ksp-gonogo/serial";
import { getActiveTimelineEpoch } from "@ksp-gonogo/sitrep-client";
import { act, fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import type { PeerClient } from "../peer/PeerClientContext";
import { PeerClientProvider } from "../peer/PeerClientContext";
import type { StationApproval } from "../peer/PeerClientService";
import {
  StationIdentityProvider,
  StationIdentityService,
} from "../stationIdentity";
import { idlePeerClient } from "../test/peerFakes";
import { setupStreamFixture } from "../test/setupStreamFixture";
import type { CountdownHold } from "./notice";
import { StationPollControl } from "./StationPollControl";
import { VOTE_INSTANCE_ID } from "./voteInput";

function station(
  client: PeerClient,
  scene = "Flight",
  fixtureOpts: Parameters<typeof setupStreamFixture>[0] = {
    suspendFrames: true,
  },
) {
  const fixture = setupStreamFixture(fixtureOpts);
  const view = render(
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
  act(() => fixture.emit("spaceCenter.scene", { scene }));
  return { ...view, fixture };
}

async function voteButton(text: string): Promise<HTMLElement> {
  const button = (await screen.findByText(text)).closest("button");
  if (button === null) throw new Error(`${text} is not on a button`);
  return button;
}

describe("GO/NO-GO in a station's header", () => {
  it("shows no GO and sends no vote while the main screen has not approved the station", async () => {
    let setApproval: (a: StationApproval) => void = () => {};
    const votes: Array<"go" | "no-go" | null> = [];
    const client: PeerClient = {
      ...idlePeerClient(),
      getApproval: () => "refused",
      onApprovalChange: (cb) => {
        setApproval = cb;
        return () => {};
      },
      sendGonogoVote: (v) => {
        votes.push(v);
      },
    };
    const { container } = station(client);
    expect(await screen.findByText("NOT IN POLL")).toBeInTheDocument();
    expect(await voteButton("NOT IN POLL")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(votes).toEqual([]);
    await expectNoA11yViolations(container);

    await act(async () => setApproval("approved"));
    expect(await screen.findByText("NO-GO")).toBeInTheDocument();
    expect(votes.at(-1)).toBe("no-go");
  });

  it("sends no vote at all while the station waits, and refuses abort", async () => {
    const votes: Array<"go" | "no-go" | null> = [];
    const aborts: number[] = [];
    const client: PeerClient = {
      ...idlePeerClient(),
      getApproval: () => "pending",
      sendGonogoVote: (v) => {
        votes.push(v);
      },
      sendGonogoAbort: () => {
        aborts.push(1);
      },
    };
    const { fixture } = station(client, "Flight", { pinnedUt: 100 });
    act(() => fixture.emit("vessel.identity", { launchUt: 10 }));
    const abort = await voteButton("ABORT");
    expect(abort).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(abort);
    act(() => {
      dispatchAction(VOTE_INSTANCE_ID, "abort", {
        kind: "button",
        value: true,
      });
    });
    expect(aborts).toEqual([]);
    expect(votes).toEqual([]);
  });

  it("flips the vote on a press and says what fires at T-0 on hover", async () => {
    const votes: Array<"go" | "no-go" | null> = [];
    const client: PeerClient = {
      ...idlePeerClient(),
      sendGonogoVote: (v) => {
        votes.push(v);
      },
      onGonogoOnGo: (cb) => {
        cb("Stage");
        return () => {};
      },
    };
    station(client);
    const button = await voteButton("NO-GO");
    expect(button).toHaveAttribute("data-tooltip", "On go: Stage");
    fireEvent.click(button);
    expect(await screen.findByText("GO")).toBeInTheDocument();
    expect(votes.at(-1)).toBe("go");
  });

  it("takes the bound input for the vote", async () => {
    station(idlePeerClient());
    await screen.findByText("NO-GO");
    act(() => {
      dispatchAction(VOTE_INSTANCE_ID, "toggle-vote", {
        kind: "button",
        value: true,
      });
    });
    expect(await screen.findByText("GO")).toBeInTheDocument();
  });

  it("is out of the poll outside the flight scene", () => {
    const votes: Array<"go" | "no-go" | null> = [];
    station(
      {
        ...idlePeerClient(),
        sendGonogoVote: (v) => {
          votes.push(v);
        },
      },
      "SpaceCenter",
    );
    expect(screen.queryByText("NO-GO")).toBeNull();
    expect(votes.at(-1)).toBeNull();
  });

  it("drops its vote and countdown when the main screen resets the poll", async () => {
    let reset: (reopened: boolean) => void = () => {};
    const votes: Array<"go" | "no-go" | null> = [];
    const client: PeerClient = {
      ...idlePeerClient(),
      sendGonogoVote: (v) => {
        votes.push(v);
      },
      onGonogoReset: (cb) => {
        reset = cb;
        return () => {};
      },
      onGonogoCountdownStart: (cb) => {
        cb(Date.now() + 30_000);
        return () => {};
      },
    };
    station(client);
    fireEvent.click(await voteButton("NO-GO"));
    expect(await screen.findByText("GO")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toBeInTheDocument();
    await act(async () => reset(false));
    expect(await screen.findByText("NO-GO")).toBeInTheDocument();
    expect(screen.queryByRole("timer")).toBeNull();
    expect(votes.at(-1)).toBe("no-go");
  });

  it("drops its countdown when the main screen restarts mid-countdown", async () => {
    let restart: () => void = () => {};
    const client: PeerClient = {
      ...idlePeerClient(),
      onHostRestart: (cb) => {
        restart = cb;
        return () => {};
      },
      onGonogoCountdownStart: (cb) => {
        cb(Date.now() + 30_000);
        return () => {};
      },
    };
    station(client);
    expect(await screen.findByRole("timer")).toBeInTheDocument();
    await act(async () => restart());
    expect(screen.queryByRole("timer")).toBeNull();
  });

  it("drops the staging banner when the main screen restarts", async () => {
    let restart: () => void = () => {};
    let outcome: (action: string | null, sent: boolean) => void = () => {};
    const client: PeerClient = {
      ...idlePeerClient(),
      onHostRestart: (cb) => {
        restart = cb;
        return () => {};
      },
      onGonogoOutcome: (cb) => {
        outcome = cb;
        return () => {};
      },
    };
    station(client);
    await screen.findByText("NO-GO");
    await act(async () => outcome("Stage", true));
    expect(screen.getByText("Stage sent")).toBeInTheDocument();
    await act(async () => restart());
    expect(screen.queryByText("Stage sent")).toBeNull();
  });

  it("drops the abort attribution when the main screen starts the poll over", async () => {
    let reset: (reopened: boolean) => void = () => {};
    let aborted: (name: string, t: number) => void = () => {};
    const client: PeerClient = {
      ...idlePeerClient(),
      onGonogoReset: (cb) => {
        reset = cb;
        return () => {};
      },
      onGonogoAbortNotify: (cb) => {
        aborted = cb;
        return () => {};
      },
    };
    station(client);
    await screen.findByText("NO-GO");
    await act(async () => aborted("CAPCOM", 1));
    expect(screen.getByText("Aborted by CAPCOM")).toBeInTheDocument();
    await act(async () => reset(false));
    expect(screen.queryByText("Aborted by CAPCOM")).toBeNull();
  });

  it("shows why a countdown was held and which station dropped", async () => {
    let hold: (reason: string | undefined, h: CountdownHold) => void = () => {};
    const client: PeerClient = {
      ...idlePeerClient(),
      onGonogoCountdownCancel: (cb) => {
        hold = cb;
        return () => {};
      },
    };
    const { container } = station(client);
    await screen.findByText("NO-GO");
    await act(async () =>
      hold("station disconnected", { cause: "dropped", station: "9A35" }),
    );
    expect(screen.getByText("Held: 9A35 dropped")).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("shows whether the T-0 action was sent", async () => {
    let outcome: (action: string | null, sent: boolean) => void = () => {};
    const client: PeerClient = {
      ...idlePeerClient(),
      onGonogoOutcome: (cb) => {
        outcome = cb;
        return () => {};
      },
    };
    station(client);
    await screen.findByText("NO-GO");
    await act(async () => outcome("Stage", false));
    expect(screen.getByText("Stage not sent")).toBeInTheDocument();
    await act(async () => outcome("Stage", true));
    expect(screen.getByText("Stage sent")).toBeInTheDocument();
  });

  it("says why the T-0 action was not sent when the host gives the refusal", async () => {
    let outcome: (action: string | null, sent: boolean, why?: string) => void =
      () => {};
    const client: PeerClient = {
      ...idlePeerClient(),
      onGonogoOutcome: (cb) => {
        outcome = cb;
        return () => {};
      },
    };
    station(client);
    await screen.findByText("NO-GO");
    await act(async () =>
      outcome("Stage", false, "Stage refused: there is no active craft."),
    );
    expect(
      screen.getByText("Stage refused: there is no active craft."),
    ).toBeInTheDocument();
  });

  it("opens the vote's input binding from the gear", async () => {
    station(idlePeerClient());
    fireEvent.click(screen.getByRole("button", { name: "Vote input" }));
    expect(await screen.findByText("Toggle GO/NO-GO")).toBeInTheDocument();
  });

  describe("on a new link to a main screen", () => {
    function relinking() {
      const sent: Array<"go" | "no-go" | null> = [];
      let approval: StationApproval = "approved";
      const listeners = new Set<(a: StationApproval) => void>();
      const announce = (a: StationApproval) => {
        for (const cb of listeners) cb(a);
      };
      const restarts = new Set<() => void>();
      const restart = () => {
        for (const cb of restarts) cb();
      };
      const client: PeerClient = {
        ...idlePeerClient(),
        getApproval: () => approval,
        onApprovalChange: (cb) => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
        onHostRestart: (cb) => {
          restarts.add(cb);
          return () => restarts.delete(cb);
        },
        sendGonogoVote: (v) => {
          sent.push(v);
        },
      };
      return {
        client,
        sent,
        relink: (next: StationApproval) => {
          approval = "unknown";
          announce("unknown");
          restart();
          approval = next;
          announce(next);
        },
        announce,
        restart,
      };
    }

    it("sends nothing until the new main screen approves, then exactly one NO-GO", async () => {
      const { client, sent, announce, restart } = relinking();
      station(client);
      await screen.findByText("NO-GO");
      sent.length = 0;

      await act(async () => {
        announce("unknown");
        restart();
      });
      expect(sent).toEqual([]);
      await act(async () => announce("approved"));
      expect(sent).toEqual(["no-go"]);
    });

    it("turns a held GO into NO-GO before the resend", async () => {
      const { client, sent, announce, restart } = relinking();
      station(client);
      fireEvent.click(await voteButton("NO-GO"));
      await screen.findByText("GO");
      sent.length = 0;

      await act(async () => {
        announce("unknown");
        restart();
      });
      await act(async () => announce("approved"));
      expect(sent).toEqual(["no-go"]);
    });

    it("resends a GO with the timeline it was cast on, so the main screen can refuse it after a load", async () => {
      const { client, announce } = relinking();
      const sentWithEpoch: Array<[string | null, number | undefined]> = [];
      client.sendGonogoVote = (v, epoch) => {
        sentWithEpoch.push([v, epoch]);
      };
      station(client);
      fireEvent.click(await voteButton("NO-GO"));
      await screen.findByText("GO");
      const castOn = getActiveTimelineEpoch()?.epoch;
      expect(castOn).toBeTypeOf("number");
      sentWithEpoch.length = 0;

      await act(async () => announce("unknown"));
      await act(async () => announce("approved"));

      expect(sentWithEpoch).toEqual([["go", castOn]]);
    });

    it("never sends a vote to a main screen that refuses the station", async () => {
      const { client, sent, relink } = relinking();
      station(client);
      await screen.findByText("NO-GO");
      sent.length = 0;

      await act(async () => relink("refused"));
      expect(sent).toEqual([]);
    });
  });
});
