import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StationApproval } from "../peer/PeerClientService";
import type { PendingStation } from "../peer/PeerHostService";
import { stationApprovals } from "../peer/stationApprovals";
import {
  StationIdentityProvider,
  StationIdentityService,
} from "../stationIdentity";
import { ApprovedStations } from "./ApprovedStations";
import { StationApprovalNotice } from "./StationApprovalNotice";
import { StationApprovalPrompt } from "./StationApprovalPrompt";

class FakeHost {
  pending: readonly PendingStation[] = [];
  approved: string[] = [];
  refused: string[] = [];
  removed: string[] = [];
  private listeners = new Set<(p: readonly PendingStation[]) => void>();
  pendingStations = () => this.pending;
  private leftListeners = new Set<(s: PendingStation) => void>();
  onPendingStationLeft = (cb: (s: PendingStation) => void) => {
    this.leftListeners.add(cb);
    return () => {
      this.leftListeners.delete(cb);
    };
  };
  leave(peerId: string) {
    const gone = this.pending.find((p) => p.peerId === peerId);
    if (!gone) return;
    this.set(this.pending.filter((p) => p.peerId !== peerId));
    act(() => {
      for (const cb of this.leftListeners) cb(gone);
    });
  }
  onPendingStationsChange = (cb: (p: readonly PendingStation[]) => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };
  approveStation = (peerId: string) => {
    this.approved.push(peerId);
    this.set(this.pending.filter((p) => p.peerId !== peerId));
  };
  refuseStation = (peerId: string) => {
    this.refused.push(peerId);
    this.set(this.pending.filter((p) => p.peerId !== peerId));
  };
  removeApprovedStation = (credential: string) => {
    this.removed.push(credential);
    stationApprovals.remove(credential);
  };
  set(next: readonly PendingStation[]) {
    this.pending = next;
    act(() => {
      for (const cb of this.listeners) cb(next);
    });
  }
}

class FakeClient {
  approval: StationApproval = "unknown";
  asked = 0;
  private listeners = new Set<(a: StationApproval) => void>();
  getApproval = () => this.approval;
  onApprovalChange = (cb: (a: StationApproval) => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };
  askAgain = () => {
    this.asked++;
  };
  private refusals = new Set<(refused: string) => void>();
  onWriteRefused = (cb: (refused: string) => void) => {
    this.refusals.add(cb);
    return () => {
      this.refusals.delete(cb);
    };
  };
  refuse(refused: string) {
    act(() => {
      for (const cb of this.refusals) cb(refused);
    });
  }
  set(next: StationApproval) {
    this.approval = next;
    act(() => {
      for (const cb of this.listeners) cb(next);
    });
  }
}

afterEach(() => {
  localStorage.clear();
});

describe("StationApprovalPrompt", () => {
  it("asks about each waiting station by name, and approves or refuses it", async () => {
    const host = new FakeHost();
    const { container } = render(<StationApprovalPrompt host={host} />);
    expect(container).toBeEmptyDOMElement();
    host.set([
      { peerId: "p1", name: "Booster" },
      { peerId: "p2", name: "Retro" },
    ]);
    expect(screen.getByText("Station Booster wants to join")).toBeVisible();
    expect(screen.getByText("Station Retro wants to join")).toBeVisible();
    await expectNoA11yViolations(container);

    await userEvent.click(
      screen.getByRole("button", { name: "Approve station Booster" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Refuse station Retro" }),
    );
    expect(host.approved).toEqual(["p1"]);
    expect(host.refused).toEqual(["p2"]);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("StationApprovalPrompt naming", () => {
  it("does not say Station twice when the name already starts with it", () => {
    const host = new FakeHost();
    render(<StationApprovalPrompt host={host} />);
    host.set([{ peerId: "p1", name: "Station JQ8C" }]);
    expect(screen.getByText("Station JQ8C wants to join")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Approve station JQ8C" }),
    ).toBeVisible();
  });
});

describe("StationApprovalNotice name", () => {
  it("shows the station's own name and no code", () => {
    localStorage.setItem("gonogo.station.name", "Station HHXQ");
    const client = new FakeClient();
    client.approval = "pending";
    render(
      <StationIdentityProvider service={new StationIdentityService()}>
        <StationApprovalNotice client={client} />
      </StationIdentityProvider>,
    );
    expect(screen.getByText("Station HHXQ")).toBeVisible();
    expect(screen.queryByText(/code/i)).toBeNull();
  });
});

describe("a station that leaves before it is approved", () => {
  it("is named in the place of its request, then clears", () => {
    vi.useFakeTimers();
    try {
      const host = new FakeHost();
      const { container } = render(<StationApprovalPrompt host={host} />);
      host.set([{ peerId: "p1", name: "Station 3HXN" }]);
      host.leave("p1");
      expect(screen.queryByText(/wants to join/)).toBeNull();
      expect(
        screen.getByText("Station 3HXN left before it was approved"),
      ).toBeVisible();
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(container).toBeEmptyDOMElement();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the note when the same station asks again", () => {
    vi.useFakeTimers();
    try {
      const host = new FakeHost();
      render(<StationApprovalPrompt host={host} />);
      const station = { peerId: "p1", name: "Station 3HXN" };
      host.set([station]);
      host.leave("p1");
      host.set([{ ...station, peerId: "p2" }]);
      expect(screen.queryByText(/left before/)).toBeNull();
      expect(screen.getByText(/wants to join/)).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ApprovedStations", () => {
  it("lists each approved station with Remove", async () => {
    stationApprovals.approve("cred-a", "Booster");
    stationApprovals.approve("cred-b", "Retro");
    const host = new FakeHost();
    const { container } = render(<ApprovedStations host={host} />);
    expect(screen.getByText("Booster")).toBeVisible();
    expect(screen.getByText("Retro")).toBeVisible();
    await expectNoA11yViolations(container);

    await userEvent.click(
      screen.getByRole("button", { name: "Remove station Booster" }),
    );
    expect(host.removed).toEqual(["cred-a"]);
    expect(screen.queryByText("Booster")).toBeNull();
    expect(screen.getByText("Retro")).toBeVisible();
  });

  it("says when none are approved", () => {
    render(<ApprovedStations host={new FakeHost()} />);
    expect(screen.getByText("No stations approved yet")).toBeVisible();
  });
});

describe("StationApprovalNotice", () => {
  it("says the station is waiting, then that it was refused, with Ask again", async () => {
    const client = new FakeClient();
    const { container } = render(<StationApprovalNotice client={client} />);
    expect(container).toBeEmptyDOMElement();
    client.set("pending");
    expect(
      screen.getByText("Waiting for the main screen to approve this station"),
    ).toBeVisible();
    client.refuse("gonogo-vote");
    expect(screen.getByText("GO/NO-GO vote not sent")).toBeVisible();
    client.set("refused");
    expect(
      screen.getByText("The main screen refused this station"),
    ).toBeVisible();
    await expectNoA11yViolations(container);
    await userEvent.click(screen.getByRole("button", { name: "Ask again" }));
    expect(client.asked).toBe(1);
    client.set("approved");
    expect(container).toBeEmptyDOMElement();
  });
});
