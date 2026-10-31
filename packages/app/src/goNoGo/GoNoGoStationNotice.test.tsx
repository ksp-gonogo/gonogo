import { DashboardItemContext, ScreenProvider } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import type { PeerClient } from "../peer/PeerClientContext";
import { PeerClientProvider } from "../peer/PeerClientContext";
import type { StationApproval } from "../peer/PeerClientService";
import { idlePeerClient } from "../test/peerFakes";
import { GoNoGoComponent } from "./GoNoGoComponent";
import type { CountdownHold } from "./notice";

function station(client: PeerClient) {
  return render(
    <ScreenProvider value="station">
      <PeerClientProvider client={client}>
        <DashboardItemContext.Provider value={{ instanceId: "gng" }}>
          <GoNoGoComponent id="gng" w={6} h={8} />
        </DashboardItemContext.Provider>
      </PeerClientProvider>
    </ScreenProvider>,
  );
}

describe("GO/NO-GO station view", () => {
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
    const button = (await screen.findByText("NOT IN POLL")).closest("button");
    expect(button).toBeDisabled();
    expect(screen.queryByText("GO")).toBeNull();
    expect(votes.at(-1)).toBeNull();
    await expectNoA11yViolations(container);

    await act(async () => setApproval("approved"));
    expect(await screen.findByText("NO-GO")).toBeInTheDocument();
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
});
