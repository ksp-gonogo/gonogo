import { dispatchAction, ScreenProvider } from "@ksp-gonogo/core";
import { SerialDeviceProvider, SerialDeviceService } from "@ksp-gonogo/serial";
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

function station(client: PeerClient, scene = "Flight") {
  const fixture = setupStreamFixture();
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
  return view;
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
    expect(votes.at(-1)).toBeNull();
    await expectNoA11yViolations(container);

    await act(async () => setApproval("approved"));
    expect(await screen.findByText("NO-GO")).toBeInTheDocument();
    expect(votes.at(-1)).toBe("no-go");
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

  it("opens the vote's input binding from the gear", async () => {
    station(idlePeerClient());
    fireEvent.click(screen.getByRole("button", { name: "Vote input" }));
    expect(await screen.findByText("Toggle GO/NO-GO")).toBeInTheDocument();
  });
});
