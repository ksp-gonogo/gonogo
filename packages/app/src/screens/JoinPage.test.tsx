import { clearRegistry, ErrorBoundary } from "@ksp-gonogo/core";
import { render, screen } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LookupResult } from "../peer/lookupGame";
import { JoinPage } from "./JoinPage";
import { getJoined, setJoined } from "./seatChoice";

vi.mock("peerjs", () => {
  class FakePeer {
    on() {
      return this;
    }
    connect() {
      return { on() {}, close() {}, open: false };
    }
    destroy() {}
    disconnect() {}
  }
  return { default: FakePeer, Peer: FakePeer };
});

function renderJoin(path: string, answer?: LookupResult) {
  window.history.replaceState(null, "", path);
  const lookup = vi.fn(async () => answer ?? { kind: "none" as const });
  const view = render(
    <ErrorBoundary>
      <ModalProvider>
        <JoinPage lookup={lookup} />
      </ModalProvider>
    </ErrorBoundary>,
  );
  return { ...view, lookup };
}

const PILOT_HOSTED: LookupResult = {
  kind: "found",
  facts: { hostSeat: "pilot", stations: 3, pilots: 2 },
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  clearRegistry();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("the join page", () => {
  it("asks for a code when the address has none", () => {
    renderJoin("/join");
    expect(screen.getByLabelText("Join code")).toBeInTheDocument();
  });

  it("says no game is running on a code nobody answers", async () => {
    const { lookup } = renderJoin("/join?nope12");
    expect(
      await screen.findByText("No game is running on this code"),
    ).toBeInTheDocument();
    expect(lookup).toHaveBeenCalledWith("NOPE12", expect.any(AbortSignal));
    expect(screen.queryByRole("button", { name: /Join as/ })).toBeNull();
  });

  it("offers both seats with the host's facts once it answers", async () => {
    const { container } = renderJoin("/join?ABC234", PILOT_HOSTED);
    expect(
      await screen.findByRole("button", { name: /Join as a station/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Join as a pilot/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("3 stations connected")).toBeInTheDocument();
    expect(screen.getByText("2 pilots aboard")).toBeInTheDocument();
    expect(screen.queryByText(/Hosted from/)).toBeNull();
    await expectNoA11yViolations(container);
  });

  it("names the station count in the pilot card's style, and shows no badge for a fact the host did not give", async () => {
    renderJoin("/join?ABC234", {
      kind: "found",
      facts: { hostSeat: "main", stations: 1 },
    });
    expect(await screen.findByText("1 station connected")).toBeInTheDocument();
    expect(screen.queryByText(/aboard/)).toBeNull();
  });

  it("joins at the seat picked and waits for the host to approve it", async () => {
    renderJoin("/join?ABC234", PILOT_HOSTED);
    await userEvent.click(
      await screen.findByRole("button", { name: /Join as a pilot/ }),
    );
    expect(getJoined()).toEqual({ code: "ABC234", seat: "pilot" });
    expect(await screen.findByText("Reaching the host")).toBeInTheDocument();
  });

  it("goes straight back to the seat this browser took on the same code", async () => {
    setJoined({ code: "ABC234", seat: "station" });
    const { lookup } = renderJoin("/join?ABC234", PILOT_HOSTED);
    expect(await screen.findByText("Reaching the host")).toBeInTheDocument();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("offers the seats again on another code", async () => {
    setJoined({ code: "OTHER1", seat: "station" });
    renderJoin("/join?ABC234", PILOT_HOSTED);
    expect(
      await screen.findByRole("button", { name: /Join as a station/ }),
    ).toBeInTheDocument();
  });
});
